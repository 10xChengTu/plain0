import {
	expect,
	test,
	type ConsoleMessage,
	type Dialog,
	type Locator,
	type Page,
} from "@playwright/test";

import workspaceVersionFixture from "../fixtures/workspace-version-v1.json" with { type: "json" };

interface TestTauriInvocation {
	readonly command: string;
	readonly args: Record<string, unknown>;
}

interface TestWorkspaceVersionTransition {
	readonly command: "workspace_copy" | "workspace_move";
	readonly sourceRootId: string;
	readonly sourcePath: string;
	readonly sourceVersion: string;
	readonly targetRootId: string;
	readonly targetPath: string;
	readonly targetVersion: string;
}

const nativeWorkspaceId = "00000000-0000-4000-8000-000000000001";
const nativeRootId = "00000000-0000-4000-8000-000000000101";
const nativeSecondaryRootId = "00000000-0000-4000-8000-000000000102";
// A real, minimally valid 1x1 transparent PNG (68 bytes: signature + IHDR +
// IDAT + IEND, each chunk's CRC32 verified). Used to exercise the genuine
// upstream binary-detection path (detectEncodingFromBuffer's zero-byte scan
// in src/vs/workbench/services/textfile/common/encoding.ts): this fixture
// contains real 0x00 bytes that do not fit the UTF-16 LE/BE zero-byte
// pattern, so it is flagged `seemsBinary` exactly like a real PNG on disk
// would be, rather than being special-cased by name or extension.
const MINIMAL_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
type RawReadTransport = "arrayBuffer" | "numberArray";
type NativeIpcMockMode = "readonly" | "supported";
type TestMultiRootMoveIncompleteScenario = "moveRetained" | "movePartial";
type TestMultiRootDeleteIncompleteScenario = "deleteRetained" | "deletePartial";
type TestWorkspaceTrashOutcome =
	| Readonly<{ status: "trashed" }>
	| Readonly<{
			status: "entryRetained";
			reason: "entryChanged" | "entryUnverifiable" | "trashFailed";
	  }>
	| Readonly<{ status: "outcomeUnknown" }>;

interface TestWorkspaceWatchExchange {
	readonly callIndex: number;
	readonly request: Readonly<{
		roots: readonly Readonly<{
			rootId: string;
			acknowledgedGeneration: number | null;
		}>[];
	}>;
	readonly result: Readonly<{
		workspaceId: string;
		roots: readonly Readonly<{
			rootId: string;
			generation: number;
			rescanRequired: boolean;
		}>[];
	}>;
}

interface TestWorkspaceWatchExchangeTiming {
	readonly callIndex: number;
	readonly observedAt: number;
}

interface TestMultiRootExternalCreateTiming {
	readonly rootId: string;
	readonly name: string;
	readonly injectedAt: number;
}

type TestMultiRootWatchAcknowledgements = readonly [
	primary: number,
	secondary: number,
];

interface TestThemeContribution {
	readonly label: string | null;
	readonly uiTheme: "vs" | "vs-dark" | "hc-black" | "hc-light";
	readonly path: string;
}

/** `F060` S3: one `contributes.iconThemes[]`/`contributes.
 * productIconThemes[]` entry — mirrors `ThemeIconContribution`
 * (`app/platform/tauri/contracts.ts`). */
interface TestThemeIconContribution {
	readonly id: string;
	readonly label: string | null;
	readonly path: string;
}

interface TestThemePackageSummary {
	readonly id: string;
	readonly publisher: string;
	readonly name: string;
	readonly version: string;
	readonly themes: readonly TestThemeContribution[];
	readonly iconThemes: readonly TestThemeIconContribution[];
	readonly productIconThemes: readonly TestThemeIconContribution[];
	readonly resources: readonly string[];
	readonly containsCode: boolean;
}

interface TestThemePackageFixture {
	readonly summary: TestThemePackageSummary;
	readonly resourceContents: Readonly<Record<string, string>>;
}

type TestThemeImportOutcome =
	| Readonly<{ status: "cancelled" }>
	| Readonly<{ status: "imported"; fixture: TestThemePackageFixture }>
	// Not a real `ThemeImportResult` shape — a Playwright-only extension so a
	// test can script a *failed* import (Rust would reject via a thrown
	// `CommandError`, never a success-shaped result).
	| Readonly<{ status: "failed"; code: string; message: string }>;

/** `F080` S2: deterministic `git_status`/`git_show_blob` responses for
 * `PlainScmView`/`PlainGitTextModelContentProvider` scenarios — the same
 * fields `app/platform/tauri/browser-mock.ts`'s real
 * `BrowserMockGitFixtureForTest` models, reproduced here because this file's
 * mock drives the real `native.ts` transport rather than reusing
 * `browser-mock.ts` (see `installNativeIpcMock`'s own module doc comment). */
interface TestGitStatusEntry {
	readonly type:
		"ordinary" | "renameOrCopy" | "unmerged" | "untracked" | "ignored";
	readonly indexStatus?: string;
	readonly worktreeStatus?: string;
	readonly path: string;
	readonly origPath?: string;
}
interface TestGitFixture {
	readonly branch?: Readonly<{
		oid: string;
		head: string;
		upstream: Readonly<{ name: string; ahead: number; behind: number }> | null;
	}>;
	readonly entries?: readonly TestGitStatusEntry[];
	readonly blobs?: Readonly<
		Record<string, Partial<Record<"head" | "index", string>>>
	>;
	readonly noRepositoryForTest?: boolean;
	// `F090` S6: seeds for the seven history/blame/graph/refs/stash/worktree
	// views' own commands — same field shapes
	// `app/platform/tauri/browser-mock.ts`'s own `BrowserMockGitFixtureForTest`
	// models, reproduced here for the same reason every other field on this
	// interface is (see `installNativeIpcMock`'s own module doc comment: this
	// file drives the real `native.ts` transport directly, never
	// `browser-mock.ts`).
	readonly blame?: Readonly<Record<string, TestGitBlameFileResult>>;
	readonly blameCommitMessages?: Readonly<Record<string, string>>;
	readonly fileHistory?: Readonly<Record<string, TestGitHistoryListResult>>;
	readonly lineHistoryList?: Readonly<Record<string, TestGitHistoryListResult>>;
	readonly lineHistoryDetail?: Readonly<
		Record<string, Readonly<{ sha: string; diffText: string }>>
	>;
	readonly showCommit?: Readonly<Record<string, TestGitShowCommitResult>>;
	readonly commitBlobs?: Readonly<
		Record<string, Readonly<Record<string, string>>>
	>;
	readonly graphForTest?: TestGitLogGraphResult;
	readonly refsForTest?: TestGitRefsListResult;
	readonly remotesForTest?: TestGitRemotesListResult;
	readonly reflogForTest?: TestGitReflogListResult;
	readonly contributorsForTest?: TestGitContributorsListResult;
	readonly branchUnmergedForTest?: readonly string[];
	readonly historyConflictForTest?: Partial<
		Readonly<Record<TestGitHistoryOperation, readonly string[]>>
	>;
	/** Playwright-only deterministic in-flight window for Cancel coverage. */
	readonly historyDelayMsForTest?: number;
	readonly stashForTest?: readonly TestGitStashEntry[];
	readonly stashShowForTest?: Readonly<Record<string, TestGitShowCommitResult>>;
	readonly stashConflictForTest?: Readonly<Record<string, readonly string[]>>;
	readonly worktreesForTest?: readonly TestGitWorktreeEntry[];
	readonly worktreeAddCancelledForTest?: boolean;
	readonly worktreeDirtyForTest?: readonly string[];
}

/** `F090` S6: the blame/history/commit-detail/graph/refs/stash/worktree
 * fixture element types `TestGitFixture` above references — reproduced from
 * `app/platform/tauri/contracts.ts`'s own wire shapes for the same reason
 * `TestGitFixture` itself is (see `installNativeIpcMock`'s own module doc
 * comment). */
interface TestGitBlameCommitHeader {
	readonly author: string;
	readonly authorMail: string;
	readonly authorTime: number;
	readonly authorTz: string;
	readonly committer: string;
	readonly committerMail: string;
	readonly committerTime: number;
	readonly committerTz: string;
	readonly summary: string;
}
interface TestGitBlameLineEntry {
	readonly commitSha: string;
	readonly isUncommitted: boolean;
	readonly origLine: number;
	readonly finalLine: number;
	readonly isBoundary: boolean;
	readonly filename: string;
	readonly previous: Readonly<{ sha: string; path: string }> | null;
}
interface TestGitBlameFileResult {
	readonly entries: readonly TestGitBlameLineEntry[];
	readonly commits: Readonly<Record<string, TestGitBlameCommitHeader>>;
}
interface TestGitHistoryEntry {
	readonly sha: string;
	readonly message: string;
}
interface TestGitHistoryListResult {
	readonly entries: readonly TestGitHistoryEntry[];
	readonly truncated: boolean;
}
interface TestGitDiffFileEntry {
	readonly kind:
		| "added"
		| "copied"
		| "deleted"
		| "modified"
		| "renamed"
		| "typeChanged"
		| "unmerged"
		| "unknown";
	readonly similarity: number | null;
	readonly path: string;
	readonly origPath: string | null;
	readonly added: number | null;
	readonly deleted: number | null;
	readonly binary: boolean;
}
interface TestGitShowCommitResult {
	readonly sha: string;
	readonly parentSha: string | null;
	readonly files: readonly TestGitDiffFileEntry[];
}
interface TestGitGraphNode {
	readonly sha: string;
	readonly parents: readonly string[];
	readonly subject: string;
}
interface TestGitLogGraphResult {
	readonly nodes: readonly TestGitGraphNode[];
	readonly truncated: boolean;
}
interface TestGitRefEntry {
	readonly kind: "branch" | "remoteBranch" | "tag";
	readonly fullName: string;
	readonly shortName: string;
	readonly targetSha: string;
	readonly isAnnotatedTag: boolean;
	readonly peeledSha: string | null;
	readonly upstream: string | null;
	readonly isHead: boolean;
}
interface TestGitRefsListResult {
	readonly entries: readonly TestGitRefEntry[];
	readonly truncated: boolean;
}
interface TestGitRemoteEntry {
	readonly name: string;
	readonly fetchUrls: readonly string[];
	readonly pushUrls: readonly string[];
}
interface TestGitRemotesListResult {
	readonly entries: readonly TestGitRemoteEntry[];
	readonly truncated: boolean;
}
interface TestGitReflogEntry {
	readonly sha: string;
	readonly selector: string;
	readonly committerTime: number;
	readonly summary: string;
}
interface TestGitReflogListResult {
	readonly entries: readonly TestGitReflogEntry[];
	readonly truncated: boolean;
}
interface TestGitContributorEntry {
	readonly name: string;
	readonly email: string;
	readonly commits: number;
}
interface TestGitContributorsListResult {
	readonly entries: readonly TestGitContributorEntry[];
	readonly truncated: boolean;
}
type TestGitHistoryOperation =
	| "merge"
	| "rebase"
	| "cherryPick"
	| "revert"
	| "resetSoft"
	| "resetMixed"
	| "resetHard";
type TestGitSequencerKind = "merge" | "rebase" | "cherryPick" | "revert";
interface TestGitStashEntry {
	readonly index: number;
	readonly sha: string;
	readonly committerTime: number;
	readonly message: string;
}
interface TestGitWorktreeEntry {
	readonly path: string;
	readonly headSha: string | null;
	readonly headState:
		| Readonly<{ kind: "branch"; refName: string }>
		| Readonly<{ kind: "detached" }>
		| Readonly<{ kind: "bare" }>;
	readonly lockReason: string | null;
	readonly prunableReason: string | null;
	readonly isMain: boolean;
}

/** `F080` S4: seeds `git_network_preview`/`git_fetch`/`git_pull`/`git_push`
 * responses for `PlainScmView`'s fetch/pull/push confirm-then-mutate flow —
 * the same fields `app/platform/tauri/browser-mock.ts`'s own
 * `BrowserMockGitNetworkFixtureForTest` models (see that interface's doc
 * comment for why this mock never re-implements real ahead/behind or
 * non-fast-forward semantics), reproduced here for the same reason
 * `TestGitFixture` itself is reproduced rather than imported: this fixture
 * drives the real `native.ts` transport directly, not `browser-mock.ts`. Adds
 * one Playwright-only field, `delayMs`, with no `browser-mock.ts` analogue:
 * that mock's calls all resolve same-tick (nothing to usefully delay),
 * whereas a Browser E2E test needs a way to deterministically observe a
 * fetch/pull/push still in flight to exercise the Cancel button and
 * `git_network_cancel`. */
interface TestGitNetworkFixture {
	/** Defaults to `"origin/main"`. `null` simulates no upstream configured —
	 * matches the real `GIT_NETWORK_NO_UPSTREAM` preview rejection for
	 * `"pull"`/`"push"`, and the real `{ upstream: null, ahead: null, behind:
	 * null }` outcome for `"fetch"`. */
	readonly upstream?: string | null;
	/** Defaults to `0`. */
	readonly ahead?: number;
	/** Defaults to `0`. A mock `git_push` rejects with `GIT_PUSH_REJECTED`
	 * while this is still nonzero and `force` is `false`. */
	readonly behind?: number;
	/** When `true`, a mock force push (`git_push` with `force: true`) always
	 * rejects with `GIT_PUSH_REJECTED`, regardless of `behind`. */
	readonly forcePushRejectedForTest?: boolean;
	/** Defaults to `0`. When nonzero, `git_fetch`/`git_pull`/`git_push` await
	 * this many milliseconds before resolving/rejecting. */
	readonly delayMs?: number;
}

/** `F100` S3: the debug domain's own fixture types, reproduced from
 * `app/platform/tauri/contracts.ts`'s wire shapes for the same reason every
 * other `TestGit*`/`TestTheme*` type here is (see `installNativeIpcMock`'s
 * own module doc comment: this file drives the real `native.ts` transport
 * directly, never `app/platform/tauri/browser-mock.ts`). */
interface TestDebugStackFrame {
	readonly id: number;
	readonly name: string;
	readonly line: number;
	readonly column: number;
	readonly sourcePath: string | null;
	readonly sourceName: string | null;
	/** `F210` S5 — the read-only Disassembly view's own sole anchor source. */
	readonly instructionPointerReference: string | null;
}
interface TestDebugScope {
	readonly name: string;
	readonly variablesReference: number;
	readonly namedVariables: number | null;
	readonly indexedVariables: number | null;
	readonly expensive: boolean;
}
/** `F210` S4 — one `stepInTargets` entry. */
interface TestDebugStepInTarget {
	readonly id: number;
	readonly label: string;
}
interface TestDebugVariable {
	readonly name: string;
	readonly value: string;
	readonly type: string | null;
	readonly variablesReference: number;
	readonly namedVariables: number | null;
	readonly indexedVariables: number | null;
}
interface TestDebugEvaluateResult {
	readonly result: string;
	readonly type: string | null;
	readonly variablesReference: number;
	readonly namedVariables: number | null;
	readonly indexedVariables: number | null;
}
/** `F210` S5 — one `disassemble` instruction entry. */
interface TestDebugDisassembledInstruction {
	readonly address: string;
	readonly instructionBytes: string | null;
	readonly instruction: string;
	readonly symbol: string | null;
}

/**
 * Deterministic `debug_launch`/`debug_attach`/`debug_set_breakpoints`/
 * `debug_stack_trace`/`debug_scopes`/`debug_variables`/`debug_evaluate`
 * responses (`F100` S3) — mirrors `app/platform/tauri/browser-mock.ts`'s own
 * `BrowserMockDebugFixtureForTest`, reproduced here for the reason every
 * other `Test*Fixture` interface in this file is (see
 * `installNativeIpcMock`'s own module doc comment).
 */
interface TestDebugFixture {
	/** The negotiated `Capabilities` every mock `debug_launch`/`debug_attach`
	 * call returns — defaults to `{}` (every `supportsXxx` query answers
	 * `false`). */
	readonly capabilities?: Readonly<Record<string, unknown>>;
	/** Keyed by `threadId` — sliced by `startFrame`/`levels` exactly like a
	 * real adapter would. */
	readonly stackFramesByThread?: Readonly<
		Record<number, readonly TestDebugStackFrame[]>
	>;
	/** Keyed by `frameId` — a missing key defaults to an empty `scopes`
	 * array. */
	readonly scopesByFrame?: Readonly<Record<number, readonly TestDebugScope[]>>;
	/** Keyed by `variablesReference` — sliced by `start`/`count` exactly like
	 * a real adapter would, so a test can seed a large synthetic collection
	 * and exercise real pagination. */
	readonly variablesByReference?: Readonly<
		Record<number, readonly TestDebugVariable[]>
	>;
	/** Keyed by the literal `expression` string — a missing key falls back to
	 * `{ result: expression, type: null, variablesReference: 0, ... }`. */
	readonly evaluateByExpression?: Readonly<
		Record<string, TestDebugEvaluateResult>
	>;
	/** Keyed by `path`, then by the *requested* line number — lets a test
	 * script an adapter moving a breakpoint to a different line
	 * (`{ line: <different number> }`) or rejecting one outright
	 * (`{ verified: false, message: "…" }`). A requested line with no
	 * scripted outcome verifies as-is, at the requested line. */
	readonly breakpointOutcomes?: Readonly<
		Record<
			string,
			Readonly<
				Record<
					number,
					Readonly<{
						readonly verified?: boolean;
						readonly line?: number;
						readonly message?: string;
					}>
				>
			>
		>
	>;
	/** `F100` S4: when `true`, every `debug_continue`/`debug_next`/
	 * `debug_step_in`/`debug_step_out`/`debug_pause` call rejects with
	 * `DEBUG_REQUEST_FAILED` (simulating a real adapter's "not stopped"
	 * rejection) instead of succeeding — lets a test exercise the adversarial
	 * "a step request issued while the session is not stopped" scenario this
	 * feature's own acceptance criteria call out by name. Defaults to
	 * `false` (every step command succeeds). */
	readonly stepRequestsRejectedForTest?: boolean;
	/** `F210` S4 — keyed by `frameId`; a missing key defaults to an empty
	 * `targets` array (a line with no call to step into), not an error. This
	 * fixture never simulates the real `MAX_DEBUG_STEP_IN_TARGETS`
	 * truncation Rust enforces — `debug_step_in_targets` always reports
	 * `truncated: false` here, mirroring `app/platform/tauri/browser-mock.ts`'s
	 * own documented scope for the same reason (that real, considered
	 * boundary is covered end to end against
	 * `debug::dto::parse_step_in_targets_response` directly in
	 * `src-tauri/src/debug/dto.rs`'s own tests). */
	readonly stepInTargetsByFrame?: Readonly<
		Record<number, readonly TestDebugStepInTarget[]>
	>;
	/** `F210` S5 — keyed by `memoryReference`, then by the *requested*
	 * `instructionOffset` — lets a test script a full disassembly window per
	 * page (the initial load's `0` offset, an Up page's negative offset, a
	 * Down page's positive offset). A missing key defaults to an empty
	 * `instructions` array, not an error. */
	readonly disassemblyByMemoryReference?: Readonly<
		Record<
			string,
			Readonly<Record<number, readonly TestDebugDisassembledInstruction[]>>
		>
	>;
	/** `F210` S5 — artificially delays each `debug_disassemble` response by
	 * this many milliseconds, mirroring `textSearchPollDelayMsForTest`'s own
	 * "deterministically observe a request still in flight" purpose — lets
	 * the paging single-in-flight test assert the Up/Down buttons are really
	 * disabled for the request's whole duration instead of racing a same-tick
	 * mock response. Defaults to `0` (no delay). */
	readonly disassembleDelayMsForTest?: number;
	/** `F210` S6 — scripts the spawn-then-connect (`transport: "tcpSpawn"`)
	 * outcome every mock `debug_launch`/`debug_attach` call reaches once past
	 * the trust/confirmation gates above — defaults to `"success"`; mirrors
	 * `app/platform/tauri/browser-mock.ts`'s own
	 * `BrowserMockDebugFixtureForTest.tcpSpawnOutcomeForTest`. */
	readonly tcpSpawnOutcomeForTest?:
		"success" | "processExitedBeforeListening" | "connectTimedOut";
}

interface TestUntitledFixture {
	readonly savePicks?: readonly Readonly<{
		status: "selected" | "cancelled";
		name?: string;
	}>[];
	readonly persistScratchForTest?: boolean;
}

/** `F220` S1: deterministic `remote_session_connect`/`remote_host_key_confirm`/
 * `remote_session_state`/`remote_host_key_list` responses — mirrors
 * `app/platform/tauri/browser-mock.ts`'s own `BrowserMockRemoteFixtureForTest`,
 * reproduced here for the reason every other `Test*Fixture` interface in this
 * file is (see `installNativeIpcMock`'s own module doc comment: this file
 * drives the real `native.ts` transport rather than reusing `browser-mock.ts`). */
type TestRemoteConnectOutcome = "success" | "authRejected" | "connectTimedOut";
interface TestRemoteFixture {
	readonly pinnedHostsForTest?: readonly Readonly<{
		host: string;
		port: number;
	}>[];
	readonly connectOutcomesForTest?: Readonly<
		Record<string, TestRemoteConnectOutcome>
	>;
	readonly changedHostKeyTargetsForTest?: readonly string[];
	/** `F220` S3: the mock's own remote-filesystem browse tree, keyed by
	 * absolute POSIX path (every ancestor directory must have its own entry —
	 * this fixture never fabricates intermediate directories). Defaults to a
	 * small built-in `/home/octocat` tree when omitted, mirroring
	 * `app/platform/tauri/browser-mock.ts`'s own `directoryTreeForTest`. */
	readonly directoryTreeForTest?: Readonly<
		Record<string, "directory" | Readonly<{ content: string }>>
	>;
}

async function installNativeIpcMock(
	page: Page,
	rawReadTransport: RawReadTransport,
	mode: NativeIpcMockMode = "readonly",
	// Extra root-relative files/directories to seed on top of the fixed
	// fixture below, keyed by relative path (nested paths create their
	// intermediate directories). Only the file-search test currently passes
	// this — every other existing call site keeps the exact unmodified
	// fixture it always had.
	extraFiles: Readonly<Record<string, string>> = {},
	// Lowers the streaming text search match budget so `limitHit` is
	// reachable with a small fixture instead of a real 20,000-match one.
	// Only the streaming text search test passes this.
	textSearchMaxMatchesForTest = 20_000,
	// Artificially delays each workspace_search_text_poll response by this
	// many milliseconds, so a test can deterministically observe a search
	// still in flight (and exercise cancelling it) instead of racing a
	// same-tick mock that would otherwise complete before the next
	// Playwright action runs. Only the cancellation test passes this.
	textSearchPollDelayMsForTest = 0,
	// Pre-seeds the theme library as if these packages were already imported
	// in a previous session (consumed by `theme_list`). Only F050 S3's own
	// theme tests pass this.
	themeLibraryFixtureForTest: readonly TestThemePackageFixture[] = [],
	// Consumed in order by `theme_import_vsix`/`theme_import_directory`; an
	// empty queue falls back to `{ status: "cancelled" }`. Only F050 S3's own
	// theme tests pass this.
	themeImportOutcomesForTest: readonly TestThemeImportOutcome[] = [],
	// Pre-seeds the persisted color theme selection as if `theme_set_
	// selection` had already stored this value (or `null`/omitted for
	// "nothing persisted yet") in a previous session; consumed by
	// `theme_get_selection`. Only F050 S4's own selection tests pass this.
	themeSelectionForTest: string | null = null,
	// `F060` S3: the file icon/product icon theme axis analogues of
	// `themeSelectionForTest` — independent, own-axis persisted selections.
	// Only F060 S3's own icon selection tests pass these.
	fileIconThemeSelectionForTest: string | null = null,
	productIconThemeSelectionForTest: string | null = null,
	// F070 "WebView DOM 渲染 + trust UX": pre-seeds this window's execution
	// trust state for the one fixed native root, exactly mirroring
	// `TrustService`/the browser mock's own `terminalTrustedForTest` (see
	// `app/platform/tauri/browser-mock.ts`'s doc comment) — granted trust
	// never carries over automatically, so this defaults to `false`. Only
	// this slice's own terminal tests pass this.
	terminalTrustedForTest = false,
	// `F080` S2: seeds `git_status`/`git_show_blob` responses for
	// `PlainScmView`/`PlainGitTextModelContentProvider` scenarios. Only this
	// slice's own SCM tests pass this; every other existing call site keeps
	// the default clean-repository-on-`main` fixture.
	gitFixtureForTest: TestGitFixture = {},
	// `F080` S4: seeds the deterministic `git_network_preview`/`git_fetch`/
	// `git_pull`/`git_push`/`git_network_cancel` simulation. Only this
	// slice's own fetch/pull/push tests pass this; every other existing call
	// site keeps the default (`"origin/main"`, 0 ahead, 0 behind, no delay).
	gitNetworkFixtureForTest: TestGitNetworkFixture = {},
	// `F100` S3: seeds the deterministic `debug_launch`/`debug_attach`/
	// `debug_set_breakpoints`/`debug_stack_trace`/`debug_scopes`/
	// `debug_variables`/`debug_evaluate` simulation. Only this slice's own
	// debug tests pass this; every other existing call site keeps the
	// default (empty capabilities, no scripted frames/scopes/variables).
	debugFixtureForTest: TestDebugFixture = {},
	// `F170` S3: scripts native Save As picker results and optionally keeps the
	// Rust-shaped scratch partition across a same-tab reload. Other scenarios
	// retain an empty queue and process-local scratch state.
	untitledFixtureForTest: TestUntitledFixture = {},
	// `F170` S5: scripts system-Trash terminal results in commit order. An
	// empty queue moves the selected entry to Trash successfully.
	trashOutcomesForTest: readonly TestWorkspaceTrashOutcome[] = [],
	// `F170` S5C: simulates begin-time identity revalidation rejecting a
	// changed entry before any platform Trash attempt.
	trashBeginFailuresForTest = 0,
	// `F190` S6: pre-seeds this window's persisted "N terminal sessions left
	// un-explicitly-closed by the previous run" marker, simulating a real
	// abnormal reload/crash — a fresh `terminal_lifecycle_marker` call
	// reports (and clears) exactly this value. `0` (the default) matches
	// every other existing scenario's own "ordinary mount, nothing to
	// report" expectation.
	terminalLifecycleMarkerForTest = 0,
	// `F200` S3: lowers the per-file oversize threshold `searchTextMatches`
	// applies (real default 8 MiB) so a `skippedOversize` fixture can be a
	// small string instead of a genuine 8 MiB+ file. `null` (the default)
	// keeps the real 8 MiB default. Only the skipped-files-visible test
	// passes this. Appended last (rather than alongside the other text-search
	// levers above) so every existing positional call site above this one
	// keeps its exact argument index.
	textSearchMaxFileSizeForTest: number | null = null,
	// `F220` S1: seeds the mock's own in-memory SSH known-hosts pin store and
	// scripts post-host-key-check connect outcomes. Only this slice's own
	// remote SSH tests pass this; every other existing call site keeps the
	// default (no pins, every target succeeds once past its host-key check).
	remoteFixtureForTest: TestRemoteFixture = {},
): Promise<void> {
	await page.addInitScript(
		({
			goldenRead,
			mode,
			rawReadTransport,
			pngBase64,
			extraFiles,
			textSearchMaxMatchesForTest,
			textSearchMaxFileSizeForTest,
			textSearchPollDelayMsForTest,
			themeLibraryFixtureForTest,
			themeImportOutcomesForTest,
			themeSelectionForTest,
			fileIconThemeSelectionForTest,
			productIconThemeSelectionForTest,
			terminalTrustedForTest,
			gitFixtureForTest,
			gitNetworkFixtureForTest,
			debugFixtureForTest,
			untitledFixtureForTest,
			trashOutcomesForTest,
			trashBeginFailuresForTest,
			terminalLifecycleMarkerForTest,
			remoteFixtureForTest,
		}) => {
			const calls: Array<{
				command: string;
				args: Record<string, unknown>;
			}> = [];
			const workspaceId = "00000000-0000-4000-8000-000000000001";
			const rootId = "00000000-0000-4000-8000-000000000101";
			const emptySnapshot = {
				workspaceId,
				revision: 0,
				roots: [],
			};
			const selectedSnapshot = {
				workspaceId,
				revision: 1,
				roots: [
					{
						rootId,
						displayName: "native-workspace",
						uri: `plain-workspace://${rootId}/`,
					},
				],
			};
			const closedSnapshot = {
				workspaceId,
				revision: 2,
				roots: [],
			};
			// `F220` S3: widened from the original fixed three-literal union so a
			// `remote_workspace_add_root` case can append a fourth, dynamically
			// authorized root — every pre-existing assignment below still assigns
			// one of the original fixed snapshots unchanged.
			interface MockWorkspaceRoot {
				rootId: string;
				displayName: string;
				uri: string;
			}
			interface MockWorkspaceSnapshot {
				workspaceId: string;
				revision: number;
				roots: MockWorkspaceRoot[];
			}
			let currentSnapshot: MockWorkspaceSnapshot = emptySnapshot;
			// `F220` S4: mirrors the real `WorkspaceRestoreStatus` — `"pending"`
			// until the first `workspace_snapshot` call of this (fresh, post-
			// `page.reload()`-or-not) closure consumes it, exactly once, via the
			// cold-start restore-from-`recentState` check in that case below.
			let initialRestoreStatus: "pending" | "none" | "restored" | "failed" =
				"pending";
			type MockFile = {
				kind: "file";
				bytes: Uint8Array;
				version: string;
			};
			type MockDirectory = {
				kind: "directory";
				entries: Map<string, MockNode>;
			};
			type MockNode = MockDirectory | MockFile;
			const encoder = new TextEncoder();
			const decoder = new TextDecoder();
			const userDataEntries = new Map<
				"settings" | "keybindings",
				{ revision: number; content: string }
			>([
				["settings", { revision: 1, content: "{}\n" }],
				["keybindings", { revision: 1, content: "[]\n" }],
			]);
			let versionSerial = 1;
			const nextVersion = (): string =>
				`wv1:${(versionSerial++).toString(16).padStart(64, "0")}`;
			// Hot-exit backup store: unlike the rest of this fixture's in-memory
			// state, this must survive `page.reload()` (a fresh `addInitScript`
			// execution) to prove restoration across a simulated restart, so it
			// round-trips through `sessionStorage` (which the browser itself, not
			// this script, preserves across a same-tab reload) rather than living
			// only in this closure's `Map`.
			const BACKUP_STORAGE_KEY = "__plain_test_backup_store__";
			// `F220` S4: partitioned by `(rootId, key)` identity — mirrors
			// `installMultiRootNativeIpcMock`'s own already-correct
			// `backupMapKey`/entry-shape pattern (and the real Rust `backup`
			// domain's own identity-digest partitioning) rather than this
			// fixture's pre-`F220` single-fixed-root shortcut of keying by `key`
			// alone. Required for a real remote root's hot-exit backups to
			// round-trip through `backup_read_all` at all — the previous shape
			// could only ever have replayed entries under the one fixed native
			// `rootId`.
			const backupMapKey = (entryRootId: string, key: string): string =>
				`${entryRootId}\0${key}`;
			const loadBackupEntries = (): Map<
				string,
				{ rootId: string; key: string; bytes: Uint8Array }
			> => {
				const raw = sessionStorage.getItem(BACKUP_STORAGE_KEY);
				if (raw === null) {
					return new Map();
				}
				try {
					const parsed = JSON.parse(raw) as Array<
						[string, { rootId: string; key: string; bytes: number[] }]
					>;
					return new Map(
						parsed.map(([mapKey, entry]) => [
							mapKey,
							{
								rootId: entry.rootId,
								key: entry.key,
								bytes: Uint8Array.from(entry.bytes),
							},
						]),
					);
				} catch {
					return new Map();
				}
			};
			const backupEntries = loadBackupEntries();
			const persistBackupEntries = (): void => {
				sessionStorage.setItem(
					BACKUP_STORAGE_KEY,
					JSON.stringify(
						[...backupEntries.entries()].map(([mapKey, entry]) => [
							mapKey,
							{
								rootId: entry.rootId,
								key: entry.key,
								bytes: Array.from(entry.bytes),
							},
						]),
					),
				);
			};
			// `F190` S6 "跨进程不伪造 session restore": this window's persisted
			// "N terminal sessions left un-explicitly-closed by the previous
			// run" marker — same `sessionStorage` round-trip as the backup store
			// above and for the same reason (must survive `page.reload()`,
			// unlike this closure's own in-memory state). Seeded from
			// `terminalLifecycleMarkerForTest` only when nothing is stored yet
			// (a real fresh test run) — a `page.reload()` within the same test
			// must see whatever value real `terminal_start`/`terminal_kill`
			// activity (or an already-claimed marker) actually left behind, not
			// silently reset back to the constructor argument every time.
			const TERMINAL_LIFECYCLE_MARKER_STORAGE_KEY =
				"__plain_test_terminal_lifecycle_marker__";
			if (
				sessionStorage.getItem(TERMINAL_LIFECYCLE_MARKER_STORAGE_KEY) === null
			) {
				sessionStorage.setItem(
					TERMINAL_LIFECYCLE_MARKER_STORAGE_KEY,
					String(Math.max(0, terminalLifecycleMarkerForTest)),
				);
			}
			const loadTerminalLifecycleMarker = (): number => {
				const raw = sessionStorage.getItem(
					TERMINAL_LIFECYCLE_MARKER_STORAGE_KEY,
				);
				const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
				return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
			};
			const storeTerminalLifecycleMarker = (value: number): void => {
				sessionStorage.setItem(
					TERMINAL_LIFECYCLE_MARKER_STORAGE_KEY,
					String(Math.max(0, value)),
				);
			};
			const scriptedSavePicks = [...(untitledFixtureForTest.savePicks ?? [])];
			const scriptedTrashOutcomes = [...trashOutcomesForTest];
			let scriptedTrashBeginFailures = trashBeginFailuresForTest;
			const persistScratchForTest =
				untitledFixtureForTest.persistScratchForTest === true;
			const SCRATCH_STORAGE_KEY = "__plain_test_scratch_store__";
			const loadScratchEntries = (): Map<string, Uint8Array> => {
				if (!persistScratchForTest) return new Map();
				const raw = sessionStorage.getItem(SCRATCH_STORAGE_KEY);
				if (raw === null) return new Map();
				try {
					const parsed = JSON.parse(raw) as Array<[string, number[]]>;
					return new Map(
						parsed.map(([scratchId, bytes]) => [
							scratchId,
							Uint8Array.from(bytes),
						]),
					);
				} catch {
					return new Map();
				}
			};
			const scratchEntries = loadScratchEntries();
			const persistScratchEntries = (): void => {
				if (!persistScratchForTest) return;
				sessionStorage.setItem(
					SCRATCH_STORAGE_KEY,
					JSON.stringify(
						[...scratchEntries.entries()].map(([scratchId, bytes]) => [
							scratchId,
							Array.from(bytes),
						]),
					),
				);
			};
			let nextScratchOrdinal =
				Math.max(
					0,
					...[...scratchEntries.keys()].map((scratchId) =>
						Number.parseInt(scratchId.slice(-12), 16),
					),
				) + 1;
			const plb2Frame = (
				value: Uint8Array,
			): { rootId: string; key: string; content: Uint8Array } => {
				if (
					value.byteLength < 45 ||
					value[0] !== 0x50 ||
					value[1] !== 0x4c ||
					value[2] !== 0x42 ||
					value[3] !== 0x32
				) {
					throw new Error("Malformed PLB2 browser test frame.");
				}
				const view = new DataView(
					value.buffer,
					value.byteOffset,
					value.byteLength,
				);
				const frameRootId = decoder.decode(value.slice(4, 40));
				const keyLength = value[40]!;
				const contentLength = view.getUint32(41, false);
				if (45 + keyLength + contentLength !== value.byteLength) {
					throw new Error("Malformed PLB2 browser test frame length.");
				}
				const key = decoder.decode(value.slice(45, 45 + keyLength));
				const content = value.slice(45 + keyLength);
				return { rootId: frameRootId, key, content };
			};
			const encodeBackupReadAllFrame = (): Uint8Array => {
				// `F220` S4: only ever replays entries for a root this window
				// currently has authorized (the fixed native `rootId` or a live
				// `remoteRootTrees` entry) — mirrors the real Rust `backup_read_all`
				// contract (and `installMultiRootNativeIpcMock`'s own identical
				// `activeRoots.has(rootId)` filter) of never handing back a
				// since-revoked root's backups.
				const entries = [...backupEntries.values()].filter(
					(entry) =>
						entry.rootId === rootId || remoteRootTrees.has(entry.rootId),
				);
				let total = 8;
				const encoded = entries.map((entry) => {
					const keyBytes = encoder.encode(entry.key);
					total += 36 + 5 + keyBytes.byteLength + entry.bytes.byteLength;
					return { rootId: entry.rootId, keyBytes, bytes: entry.bytes };
				});
				const frame = new Uint8Array(total);
				const view = new DataView(frame.buffer);
				frame.set([0x50, 0x4c, 0x41, 0x32], 0); // "PLA2"
				view.setUint32(4, entries.length, false);
				let offset = 8;
				for (const { rootId: entryRootId, keyBytes, bytes } of encoded) {
					frame.set(encoder.encode(entryRootId), offset);
					offset += 36;
					frame[offset] = keyBytes.byteLength;
					offset += 1;
					view.setUint32(offset, bytes.byteLength, false);
					offset += 4;
					frame.set(keyBytes, offset);
					offset += keyBytes.byteLength;
					frame.set(bytes, offset);
					offset += bytes.byteLength;
				}
				return frame;
			};
			const psw1Frame = (
				value: Uint8Array,
			): { scratchId: string; content: Uint8Array } => {
				if (
					value.byteLength < 44 ||
					value[0] !== 0x50 ||
					value[1] !== 0x53 ||
					value[2] !== 0x57 ||
					value[3] !== 0x31
				) {
					throw new Error("Malformed PSW1 browser test frame.");
				}
				const contentLength = new DataView(
					value.buffer,
					value.byteOffset,
					value.byteLength,
				).getUint32(40, false);
				if (44 + contentLength !== value.byteLength) {
					throw new Error("Malformed PSW1 browser test frame length.");
				}
				return {
					scratchId: decoder.decode(value.slice(4, 40)),
					content: value.slice(44),
				};
			};
			const encodeScratchReadAllFrame = (): Uint8Array => {
				const entries = [...scratchEntries.entries()].sort(([left], [right]) =>
					left.localeCompare(right),
				);
				const total = entries.reduce(
					(length, [, bytes]) => length + 40 + bytes.byteLength,
					8,
				);
				const frame = new Uint8Array(total);
				const view = new DataView(frame.buffer);
				frame.set([0x50, 0x53, 0x4c, 0x31], 0); // "PSL1"
				view.setUint32(4, entries.length, false);
				let offset = 8;
				for (const [scratchId, bytes] of entries) {
					frame.set(encoder.encode(scratchId), offset);
					offset += 36;
					view.setUint32(offset, bytes.byteLength, false);
					offset += 4;
					frame.set(bytes, offset);
					offset += bytes.byteLength;
				}
				return frame;
			};
			const pln1Frame = (
				value: Uint8Array,
			): { rootId: string; relativePath: string; content: Uint8Array } => {
				if (
					value.byteLength < 12 ||
					value[0] !== 0x50 ||
					value[1] !== 0x4c ||
					value[2] !== 0x4e ||
					value[3] !== 0x31
				) {
					throw new Error("Malformed PLN1 browser test frame.");
				}
				const view = new DataView(
					value.buffer,
					value.byteOffset,
					value.byteLength,
				);
				const rootLength = view.getUint16(4, false);
				const pathLength = view.getUint16(6, false);
				const contentLength = view.getUint32(8, false);
				if (
					rootLength !== 36 ||
					pathLength === 0 ||
					12 + rootLength + pathLength + contentLength !== value.byteLength
				) {
					throw new Error("Malformed PLN1 browser test frame length.");
				}
				let offset = 12;
				const frameRootId = decoder.decode(
					value.slice(offset, offset + rootLength),
				);
				offset += rootLength;
				const relativePath = decoder.decode(
					value.slice(offset, offset + pathLength),
				);
				offset += pathLength;
				return {
					rootId: frameRootId,
					relativePath,
					content: value.slice(offset),
				};
			};
			const file = (content: string): MockFile => ({
				kind: "file",
				bytes: encoder.encode(content),
				version: nextVersion(),
			});
			// Real raw-byte variant of `file` (not text-encoded) so binary fixtures
			// (e.g. the PNG below) round-trip as genuine bytes, not a string.
			const fileBytes = (bytes: Uint8Array): MockFile => ({
				kind: "file",
				bytes,
				version: nextVersion(),
			});
			const decodeBase64 = (value: string): Uint8Array => {
				const binary = atob(value);
				const decoded = new Uint8Array(binary.length);
				for (let index = 0; index < binary.length; index += 1) {
					decoded[index] = binary.charCodeAt(index);
				}
				return decoded;
			};
			const directory = (
				entries: readonly (readonly [string, MockNode])[],
			): MockDirectory => ({ kind: "directory", entries: new Map(entries) });
			const root = directory([
				[
					"README.md",
					file("# Native workspace\n\nRead-only Explorer fixture.\n"),
				],
				[
					"notes.md",
					file(
						"# Notes\n\nPlain markdown source text, no rich preview here.\n",
					),
				],
				["icon.png", fileBytes(decodeBase64(pngBase64))],
				["src", directory([["main.ts", file("export const plain = true;\n")]])],
			]);
			const ensureNestedFile = (
				relativePath: string,
				content: string,
			): void => {
				const segments = relativePath.split("/");
				let parent: MockDirectory = root;
				for (let index = 0; index < segments.length - 1; index += 1) {
					const segment = segments[index]!;
					let next = parent.entries.get(segment);
					if (next === undefined) {
						next = directory([]);
						parent.entries.set(segment, next);
					}
					if (next.kind !== "directory") {
						throw new Error("Invalid extra test fixture path.");
					}
					parent = next;
				}
				parent.entries.set(segments.at(-1)!, file(content));
			};
			for (const [relativePath, content] of Object.entries(extraFiles)) {
				ensureNestedFile(relativePath, content);
			}
			const entryNotFound = () => ({
				code: "ENTRY_NOT_FOUND",
				message: "The workspace entry does not exist.",
			});
			const entryAlreadyExists = () => ({
				code: "ENTRY_ALREADY_EXISTS",
				message: "The workspace entry already exists.",
			});
			const entryTypeMismatch = () => ({
				code: "ENTRY_TYPE_MISMATCH",
				message: "The workspace entry has an incompatible type.",
			});
			const invalidDeletePlan = () => ({
				code: "WORKSPACE_DELETE_PLAN_INVALID",
				message: "The workspace delete plan is invalid.",
			});
			const invalidTrashPlan = () => ({
				code: "WORKSPACE_TRASH_PLAN_INVALID",
				message: "The workspace Trash plan is invalid.",
			});
			const searchNotFound = () => ({
				code: "WORKSPACE_SEARCH_NOT_FOUND",
				message: "The workspace text search is no longer available.",
			});
			const invalidSearchRequest = () => ({
				code: "INVALID_SEARCH_REQUEST",
				message: "The workspace text search request is invalid.",
			});
			const invalidSearchRegex = () => ({
				code: "INVALID_SEARCH_REGEX",
				message:
					"The workspace text search pattern is not a valid regular expression.",
			});
			const pathSegments = (relativePath: string): readonly string[] =>
				relativePath.length === 0 ? [] : relativePath.split("/");
			// `F220` S3: every one of these four helpers grew an optional trailing
			// `tree` parameter defaulting to the fixed native `root` — every one
			// of their ~20 pre-existing call sites keeps its old one-argument
			// shape unchanged, while the new remote-root case blocks below pass a
			// specific remote root's own tree explicitly (see `treeForRootId`).
			const resolveNode = (
				relativePath: string,
				tree: MockDirectory = root,
			): MockNode => {
				let node: MockNode = tree;
				for (const segment of pathSegments(relativePath)) {
					if (node.kind !== "directory") {
						throw entryTypeMismatch();
					}
					const child = node.entries.get(segment);
					if (child === undefined) {
						throw entryNotFound();
					}
					node = child;
				}
				return node;
			};
			const resolveParent = (
				relativePath: string,
				tree: MockDirectory = root,
			): { parent: MockDirectory; name: string } => {
				const segments = pathSegments(relativePath);
				if (segments.length === 0) {
					throw entryTypeMismatch();
				}
				const name = segments.at(-1)!;
				const parentPath = segments.slice(0, -1).join("/");
				const parent = resolveNode(parentPath, tree);
				if (parent.kind !== "directory") {
					throw entryTypeMismatch();
				}
				return { parent, name };
			};
			const deleteNode = (
				relativePath: string,
				tree: MockDirectory = root,
			): void => {
				const { parent, name } = resolveParent(relativePath, tree);
				if (!parent.entries.delete(name)) {
					throw entryNotFound();
				}
			};
			const descendantEntries = (node: MockNode): number => {
				if (node.kind === "file") {
					return 0;
				}
				let descendants = node.entries.size;
				for (const child of node.entries.values()) {
					descendants += descendantEntries(child);
				}
				return descendants;
			};
			// Deliberately simplified `.gitignore`/exclude-glob support for
			// `workspace_search_files`: this fixture exists to prove Quick Open
			// renders real results end-to-end, not to re-implement gitignore's
			// grammar (Rust's search::file_search is the semantic authority; see
			// docs/research/2026-07-23-search-quickopen.md).
			interface MockGitignoreRule {
				negate: boolean;
				dirOnly: boolean;
				pattern: string;
			}
			interface MockGitignoreLayer {
				wire: string;
				rules: MockGitignoreRule[];
			}
			const decodeUtf8Lenient = (bytes: Uint8Array): string => {
				try {
					return decoder.decode(bytes);
				} catch {
					return "";
				}
			};
			const parseGitignoreRules = (content: string): MockGitignoreRule[] =>
				content
					.split("\n")
					.map((line) => line.replace(/\r$/, "").trim())
					.filter((line) => line.length > 0 && !line.startsWith("#"))
					.map((line) => {
						const negate = line.startsWith("!");
						const withoutBang = negate ? line.slice(1) : line;
						const dirOnly = withoutBang.endsWith("/");
						const pattern = dirOnly ? withoutBang.slice(0, -1) : withoutBang;
						return { negate, dirOnly, pattern };
					});
			const gitignoreRuleMatches = (
				rule: MockGitignoreRule,
				relative: string,
				isDir: boolean,
			): boolean => {
				if (rule.dirOnly && !isDir) {
					return false;
				}
				if (rule.pattern.includes("/")) {
					return (
						relative === rule.pattern || relative.startsWith(`${rule.pattern}/`)
					);
				}
				const segments = relative.split("/");
				const basename = segments.at(-1) ?? relative;
				if (rule.pattern.startsWith("*.")) {
					return basename.endsWith(rule.pattern.slice(1));
				}
				return basename === rule.pattern || segments.includes(rule.pattern);
			};
			const gitignoreLayerFor = (
				directory: MockDirectory,
				wire: string,
			): MockGitignoreLayer => {
				const node = directory.entries.get(".gitignore");
				const rules =
					node !== undefined && node.kind === "file"
						? parseGitignoreRules(decodeUtf8Lenient(node.bytes))
						: [];
				return { wire, rules };
			};
			const pathIsGitignored = (
				chain: readonly MockGitignoreLayer[],
				wire: string,
				isDir: boolean,
			): boolean => {
				for (let index = chain.length - 1; index >= 0; index -= 1) {
					const layer = chain[index]!;
					const relative =
						layer.wire.length === 0 ? wire : wire.slice(layer.wire.length + 1);
					let matched: boolean | undefined;
					for (const rule of layer.rules) {
						if (gitignoreRuleMatches(rule, relative, isDir)) {
							matched = !rule.negate;
						}
					}
					if (matched !== undefined) {
						return matched;
					}
				}
				return false;
			};
			const compileExcludeGlob = (
				pattern: string,
			): ((wire: string) => boolean) => {
				if (pattern.startsWith("**/") && pattern.endsWith("/**")) {
					const middle = pattern.slice(3, -3);
					return (wire) =>
						wire === middle ||
						wire.startsWith(`${middle}/`) ||
						wire.split("/").includes(middle);
				}
				if (pattern.startsWith("**/")) {
					const rest = pattern.slice(3);
					return (wire) =>
						wire === rest ||
						wire.endsWith(`/${rest}`) ||
						wire.split("/").includes(rest);
				}
				return (wire) => wire === pattern;
			};
			const isMockSearchSubsequence = (
				pattern: string,
				haystack: string,
			): boolean => {
				let haystackIndex = 0;
				for (const patternChar of pattern) {
					let found = false;
					while (haystackIndex < haystack.length) {
						const haystackChar = haystack[haystackIndex]!;
						haystackIndex += 1;
						if (haystackChar === patternChar) {
							found = true;
							break;
						}
					}
					if (!found) {
						return false;
					}
				}
				return true;
			};
			const MAX_MOCK_SEARCH_ENTRIES = 50_000;
			const MAX_MOCK_SEARCH_DEPTH = 256;
			const searchFiles = (
				requestRoots: readonly string[],
				filePattern: string,
				excludeGlobs: readonly string[],
				maxResults: number,
			): {
				entries: Array<{ rootId: string; path: string }>;
				limitHit: boolean;
			} => {
				const excludeMatchers = excludeGlobs.map(compileExcludeGlob);
				const patternLower = filePattern.toLowerCase();
				const entries: Array<{ rootId: string; path: string }> = [];
				let limitHit = false;
				let visited = 0;
				interface SearchFrame {
					directory: MockDirectory;
					wire: string;
					depth: number;
					gitignoreChain: MockGitignoreLayer[];
					names: string[];
					nextIndex: number;
				}
				rootsLoop: for (const requestedRootId of requestRoots) {
					if (requestedRootId !== rootId) {
						continue;
					}
					const frames: SearchFrame[] = [
						{
							directory: root,
							wire: "",
							depth: 0,
							gitignoreChain: [gitignoreLayerFor(root, "")],
							names: [...root.entries.keys()].sort(),
							nextIndex: 0,
						},
					];
					while (frames.length > 0) {
						const frame = frames[frames.length - 1]!;
						if (frame.nextIndex >= frame.names.length) {
							frames.pop();
							continue;
						}
						const name = frame.names[frame.nextIndex]!;
						frame.nextIndex += 1;
						visited += 1;
						if (visited > MAX_MOCK_SEARCH_ENTRIES) {
							limitHit = true;
							break rootsLoop;
						}
						const child = frame.directory.entries.get(name);
						if (child === undefined) {
							continue;
						}
						const wire =
							frame.wire.length === 0 ? name : `${frame.wire}/${name}`;
						const isDir = child.kind === "directory";
						const excluded =
							excludeMatchers.some((matches) => matches(wire)) ||
							pathIsGitignored(frame.gitignoreChain, wire, isDir);
						if (child.kind === "directory") {
							if (excluded) {
								continue;
							}
							const depth = frame.depth + 1;
							if (depth > MAX_MOCK_SEARCH_DEPTH) {
								limitHit = true;
								continue;
							}
							frames.push({
								directory: child,
								wire,
								depth,
								gitignoreChain: [
									...frame.gitignoreChain,
									gitignoreLayerFor(child, wire),
								],
								names: [...child.entries.keys()].sort(),
								nextIndex: 0,
							});
						} else if (child.kind === "file") {
							if (excluded) {
								continue;
							}
							if (
								patternLower.length > 0 &&
								!isMockSearchSubsequence(patternLower, wire.toLowerCase())
							) {
								continue;
							}
							entries.push({ rootId: requestedRootId, path: wire });
							if (entries.length >= maxResults) {
								limitHit = true;
								break rootsLoop;
							}
						}
					}
				}
				return { entries, limitHit };
			};
			const TEXT_SEARCH_PREVIEW_MAX_UTF16_UNITS = 256;
			const buildTextSearchPreview = (
				line: string,
				matchStart: number,
				matchLength: number,
			): { previewText: string; column: number } => {
				const matchEnd = matchStart + matchLength;
				const windowStart =
					matchEnd <= TEXT_SEARCH_PREVIEW_MAX_UTF16_UNITS ? 0 : matchStart;
				const windowEnd = Math.min(
					windowStart + TEXT_SEARCH_PREVIEW_MAX_UTF16_UNITS,
					line.length,
				);
				return {
					previewText: line.slice(windowStart, windowEnd),
					column: matchStart - windowStart,
				};
			};
			const escapeTextSearchRegExp = (value: string): string =>
				value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			// Matches lookahead (`(?=`/`(?!`), lookbehind (`(?<=`/`(?<!`) and
			// backreference (`\1`-`\9`) syntax — the PCRE2-only constructs the
			// real Rust engine (`grep-regex`) rejects as `INVALID_SEARCH_REGEX`
			// (F200 S3, mirrors `app/platform/tauri/browser-mock.ts`'s own
			// `PCRE2_ONLY_REGEX_CONSTRUCT`). The native `RegExp` constructor this
			// mock otherwise delegates to happily accepts all three, so without
			// this explicit pre-compile check it would silently diverge from the
			// real backend's rejection.
			const PCRE2_ONLY_REGEX_CONSTRUCT = /\(\?<?[=!]|\\[1-9]/;
			const compileTextSearchMatcher = (
				pattern: string,
				isRegExp: boolean,
				isCaseSensitive: boolean,
				isWordMatch: boolean,
			): RegExp => {
				if (isRegExp && PCRE2_ONLY_REGEX_CONSTRUCT.test(pattern)) {
					throw invalidSearchRegex();
				}
				const source = isRegExp ? pattern : escapeTextSearchRegExp(pattern);
				const wrapped = isWordMatch ? `\\b(?:${source})\\b` : source;
				try {
					return new RegExp(wrapped, isCaseSensitive ? "gu" : "giu");
				} catch {
					throw invalidSearchRegex();
				}
			};
			interface TextSearchBatch {
				rootId: string;
				path: string;
				matches: Array<{
					line: number;
					column: number;
					length: number;
					previewText: string;
					absoluteColumn: number;
				}>;
			}
			const searchTextMatches = (request: {
				roots?: readonly string[];
				pattern?: string;
				isRegExp?: boolean;
				isCaseSensitive?: boolean;
				isWordMatch?: boolean;
				excludeGlobs?: readonly string[];
				maxResults?: number;
				maxFileSize?: number | null;
			}): {
				pending: TextSearchBatch[];
				limitHit: boolean;
				skippedBinary: number;
				skippedOversize: number;
			} => {
				const requestRoots = request.roots ?? [];
				const matcher = compileTextSearchMatcher(
					request.pattern ?? "",
					request.isRegExp ?? false,
					request.isCaseSensitive ?? false,
					request.isWordMatch ?? false,
				);
				const excludeMatchers = (request.excludeGlobs ?? []).map(
					compileExcludeGlob,
				);
				const maxFileSize =
					request.maxFileSize ??
					textSearchMaxFileSizeForTest ??
					8 * 1_024 * 1_024;
				const maxResults = Math.min(
					request.maxResults ?? textSearchMaxMatchesForTest,
					textSearchMaxMatchesForTest,
				);

				const pending: TextSearchBatch[] = [];
				let limitHit = false;
				let skippedBinary = 0;
				let skippedOversize = 0;
				let remainingBudget = maxResults;
				let visited = 0;
				interface SearchFrame {
					directory: MockDirectory;
					wire: string;
					depth: number;
					gitignoreChain: MockGitignoreLayer[];
					names: string[];
					nextIndex: number;
				}

				rootsLoop: for (const requestedRootId of requestRoots) {
					if (requestedRootId !== rootId) {
						continue;
					}
					const frames: SearchFrame[] = [
						{
							directory: root,
							wire: "",
							depth: 0,
							gitignoreChain: [gitignoreLayerFor(root, "")],
							names: [...root.entries.keys()].sort(),
							nextIndex: 0,
						},
					];
					while (frames.length > 0) {
						const frame = frames[frames.length - 1]!;
						if (frame.nextIndex >= frame.names.length) {
							frames.pop();
							continue;
						}
						const name = frame.names[frame.nextIndex]!;
						frame.nextIndex += 1;
						visited += 1;
						if (visited > MAX_MOCK_SEARCH_ENTRIES) {
							limitHit = true;
							break rootsLoop;
						}
						const child = frame.directory.entries.get(name);
						if (child === undefined) {
							continue;
						}
						const wire =
							frame.wire.length === 0 ? name : `${frame.wire}/${name}`;
						const isDir = child.kind === "directory";
						const excluded =
							excludeMatchers.some((matches) => matches(wire)) ||
							pathIsGitignored(frame.gitignoreChain, wire, isDir);
						if (child.kind === "directory") {
							if (excluded) {
								continue;
							}
							const depth = frame.depth + 1;
							if (depth > MAX_MOCK_SEARCH_DEPTH) {
								limitHit = true;
								continue;
							}
							frames.push({
								directory: child,
								wire,
								depth,
								gitignoreChain: [
									...frame.gitignoreChain,
									gitignoreLayerFor(child, wire),
								],
								names: [...child.entries.keys()].sort(),
								nextIndex: 0,
							});
							continue;
						}
						if (child.kind !== "file" || excluded) {
							continue;
						}
						if (remainingBudget <= 0) {
							limitHit = true;
							break rootsLoop;
						}
						if (child.bytes.byteLength > maxFileSize) {
							skippedOversize += 1;
							continue;
						}
						if (child.bytes.includes(0)) {
							skippedBinary += 1;
							continue;
						}
						const text = decodeUtf8Lenient(child.bytes);
						const lines = text.split("\n");
						const matches: TextSearchBatch["matches"] = [];
						lineLoop: for (const [lineIndex, rawLine] of lines.entries()) {
							const line = rawLine.endsWith("\r")
								? rawLine.slice(0, -1)
								: rawLine;
							for (const found of line.matchAll(matcher)) {
								if (remainingBudget <= 0) {
									break lineLoop;
								}
								const { previewText, column } = buildTextSearchPreview(
									line,
									found.index,
									found[0].length,
								);
								matches.push({
									line: lineIndex + 1,
									column: column + 1,
									length: found[0].length,
									previewText,
									absoluteColumn: found.index + 1,
								});
								remainingBudget -= 1;
							}
						}
						if (matches.length > 0) {
							pending.push({
								rootId: requestedRootId,
								path: wire,
								matches,
							});
						}
						if (remainingBudget <= 0) {
							limitHit = true;
							break rootsLoop;
						}
					}
				}
				return { pending, limitHit, skippedBinary, skippedOversize };
			};

			// --- Capture-group replacement expansion (F200 S2) ---------------------
			//
			// A from-scratch JS-equivalent of `search::replace::expand_replacements`
			// (`src-tauri/src/search/replace.rs`) and its browser-mock twin
			// (`app/platform/tauri/browser-mock.ts`'s `expandWorkspaceSearchReplacements`):
			// builds the same word/case-wrapped matcher `compileTextSearchMatcher`
			// uses but with no "g" flag (a single anchored full-string match, never
			// iteration), tokenizes the template, and resolves each `$`-reference
			// itself so an out-of-range group reference fails closed instead of
			// silently becoming an empty string.
			const compileExpandReplaceMatcher = (
				pattern: string,
				isCaseSensitive: boolean,
				isWordMatch: boolean,
			): RegExp => {
				const wrapped = isWordMatch ? `\\b(?:${pattern})\\b` : pattern;
				try {
					return new RegExp(wrapped, isCaseSensitive ? "u" : "iu");
				} catch {
					throw invalidSearchRegex();
				}
			};
			type ExpandTemplateToken =
				| { readonly kind: "literal"; readonly text: string }
				| { readonly kind: "ref"; readonly ref: string };
			const EXPAND_TEMPLATE_REF_CHAR = /[0-9A-Za-z_]/;
			const tokenizeExpandTemplate = (
				template: string,
			): ExpandTemplateToken[] => {
				const tokens: ExpandTemplateToken[] = [];
				let index = 0;
				let literalStart = 0;
				while (index < template.length) {
					if (template[index] !== "$") {
						index += 1;
						continue;
					}
					if (literalStart < index) {
						tokens.push({
							kind: "literal",
							text: template.slice(literalStart, index),
						});
					}
					if (template[index + 1] === "$") {
						tokens.push({ kind: "literal", text: "$" });
						index += 2;
						literalStart = index;
						continue;
					}
					const braced = template[index + 1] === "{";
					const nameStart = index + 1 + (braced ? 1 : 0);
					let cursor = nameStart;
					while (
						cursor < template.length &&
						EXPAND_TEMPLATE_REF_CHAR.test(template[cursor]!)
					) {
						cursor += 1;
					}
					if (cursor === nameStart || (braced && template[cursor] !== "}")) {
						tokens.push({ kind: "literal", text: "$" });
						index += 1;
						literalStart = index;
						continue;
					}
					tokens.push({ kind: "ref", ref: template.slice(nameStart, cursor) });
					index = braced ? cursor + 1 : cursor;
					literalStart = index;
				}
				if (literalStart < template.length) {
					tokens.push({ kind: "literal", text: template.slice(literalStart) });
				}
				return tokens;
			};
			const MAX_EXPAND_REPLACE_OUTPUT_UNITS = 8_192;
			const searchReplaceExpandNoMatch = () => ({
				code: "SEARCH_REPLACE_EXPAND_NO_MATCH",
				message:
					"The recorded match text no longer matches the search pattern.",
			});
			const searchReplaceExpandInvalidGroup = () => ({
				code: "SEARCH_REPLACE_EXPAND_INVALID_GROUP",
				message:
					"The replacement template references a capture group the pattern does not have.",
			});
			const searchReplaceExpandTooLarge = () => ({
				code: "SEARCH_REPLACE_EXPAND_TOO_LARGE",
				message: "The expanded replacement text is too large.",
			});
			interface ExpandReplacementItem {
				status: "ok" | "error";
				replacement?: string;
				code?: string;
				message?: string;
			}
			const expandSearchReplacements = (request: {
				pattern?: string;
				isRegExp?: boolean;
				isCaseSensitive?: boolean;
				isWordMatch?: boolean;
				replacementTemplate?: string;
				expectedTexts?: readonly string[];
			}): { items: ExpandReplacementItem[] } => {
				if (
					request.isRegExp !== true ||
					typeof request.pattern !== "string" ||
					typeof request.replacementTemplate !== "string" ||
					!Array.isArray(request.expectedTexts)
				) {
					throw invalidSearchRequest();
				}
				const matcher = compileExpandReplaceMatcher(
					request.pattern,
					request.isCaseSensitive ?? false,
					request.isWordMatch ?? false,
				);
				const tokens = tokenizeExpandTemplate(request.replacementTemplate);
				const items = request.expectedTexts.map(
					(expectedText): ExpandReplacementItem => {
						const match = matcher.exec(expectedText);
						if (
							match === null ||
							match.index !== 0 ||
							match[0].length !== expectedText.length
						) {
							return { status: "error", ...searchReplaceExpandNoMatch() };
						}
						let output = "";
						for (const token of tokens) {
							let addition: string;
							if (token.kind === "literal") {
								addition = token.text;
							} else if (/^\d+$/.test(token.ref)) {
								const groupIndex = Number(token.ref);
								if (groupIndex >= match.length) {
									return {
										status: "error",
										...searchReplaceExpandInvalidGroup(),
									};
								}
								addition = match[groupIndex] ?? "";
							} else {
								const groups = match.groups ?? {};
								if (!Object.hasOwn(groups, token.ref)) {
									return {
										status: "error",
										...searchReplaceExpandInvalidGroup(),
									};
								}
								addition = groups[token.ref] ?? "";
							}
							if (
								output.length + addition.length >
								MAX_EXPAND_REPLACE_OUTPUT_UNITS
							) {
								return { status: "error", ...searchReplaceExpandTooLarge() };
							}
							output += addition;
						}
						return { status: "ok", replacement: output };
					},
				);
				return { items };
			};
			const bytesFromHex = (hex: string): Uint8Array => {
				const bytes = new Uint8Array(hex.length / 2);
				for (let index = 0; index < bytes.length; index += 1) {
					bytes[index] = Number.parseInt(
						hex.slice(index * 2, index * 2 + 2),
						16,
					);
				}
				return bytes;
			};
			const hexFromBytes = (bytes: Uint8Array): string =>
				[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
			const plw1Frame = (value: Uint8Array) => {
				if (
					value.byteLength < 14 ||
					value[0] !== 0x50 ||
					value[1] !== 0x4c ||
					value[2] !== 0x57 ||
					value[3] !== 0x31
				) {
					throw new Error("Malformed PLW1 browser test frame.");
				}
				const view = new DataView(
					value.buffer,
					value.byteOffset,
					value.byteLength,
				);
				const rootLength = view.getUint16(4, false);
				const pathLength = view.getUint16(6, false);
				const versionLength = view.getUint16(8, false);
				const contentLength = view.getUint32(10, false);
				const expectedLength =
					14 + rootLength + pathLength + versionLength + contentLength;
				if (expectedLength !== value.byteLength) {
					throw new Error("Malformed PLW1 browser test frame length.");
				}
				let offset = 14;
				const rootId = decoder.decode(value.slice(offset, offset + rootLength));
				offset += rootLength;
				const relativePath = decoder.decode(
					value.slice(offset, offset + pathLength),
				);
				offset += pathLength;
				const expectedVersion = decoder.decode(
					value.slice(offset, offset + versionLength),
				);
				offset += versionLength;
				const content = value.slice(offset, offset + contentLength);
				return {
					rootId,
					relativePath,
					expectedVersion,
					content,
				};
			};
			const plr1Frame = (
				content: Uint8Array,
				mtime: number,
				ctime: number,
				version: string | null,
			): Uint8Array => {
				const versionBytes =
					version === null
						? new Uint8Array()
						: new TextEncoder().encode(version);
				const frame = new Uint8Array(
					36 + versionBytes.byteLength + content.byteLength,
				);
				const view = new DataView(frame.buffer);
				frame.set([0x50, 0x4c, 0x52, 0x31], 0);
				frame[4] = 1;
				frame[5] = versionBytes.byteLength;
				view.setUint16(6, 0, false);
				view.setUint32(8, content.byteLength, false);
				view.setBigUint64(12, BigInt(content.byteLength), false);
				view.setBigUint64(20, BigInt(mtime), false);
				view.setBigUint64(28, BigInt(ctime), false);
				frame.set(versionBytes, 36);
				frame.set(content, 36 + versionBytes.byteLength);
				return frame;
			};
			const reproducedGolden = plr1Frame(
				bytesFromHex(goldenRead.contentHex),
				goldenRead.mtimeMs,
				goldenRead.ctimeMs,
				goldenRead.version,
			);
			if (hexFromBytes(reproducedGolden) !== goldenRead.frameHex) {
				throw new Error(
					"Shared PLR1 browser fixture does not reproduce exactly.",
				);
			}
			let deleteSerial = 201;
			const nextDeleteId = (): string =>
				`00000000-0000-4000-8000-${(deleteSerial++)
					.toString()
					.padStart(12, "0")}`;
			let activeDelete:
				| {
						confirmationId: string;
						entryId: string;
						// `F220` S3: the entry's own owning root, so a remote-root
						// delete batch resolves its tree the same way every other
						// case does — see `treeForRootId`.
						rootId: string;
						relativePath: string;
						recursive: boolean;
						phase: "prepared" | "executing";
				  }
				| undefined;
			let activeTrash:
				| {
						confirmationId: string;
						entryId: string;
						relativePath: string;
						phase: "prepared" | "executing";
				  }
				| undefined;
			let activeTextSearch:
				| {
						searchId: string;
						pending: TextSearchBatch[];
						deliveredCursor: number;
						limitHit: boolean;
						skippedBinary: number;
						skippedOversize: number;
				  }
				| undefined;
			let nextCallbackId = 0;
			let nextEventId = 0;
			const callbacks = new Map<
				number,
				{ callback: (payload: unknown) => void; once: boolean }
			>();
			const eventHandlers = new Map<
				number,
				{ event: string; handlerId: number }
			>();
			let watchNextGeneration = 1;
			let watchPending:
				| { rootId: string; generation: number; rescanRequired: boolean }
				| undefined;
			let watchDirty = false;
			let watchDirtyRescanRequired = false;
			const promoteWatchDirty = (): void => {
				if (watchPending !== undefined || !watchDirty) {
					return;
				}
				watchPending = {
					rootId,
					generation: watchNextGeneration,
					rescanRequired: watchDirtyRescanRequired,
				};
				watchNextGeneration = Math.min(0xffff_ffff, watchNextGeneration + 1);
				watchDirty = false;
				watchDirtyRescanRequired = false;
			};
			const emitWatchWake = (): void => {
				for (const [eventId, registration] of eventHandlers) {
					if (registration.event !== "plain://workspace-watch-wake") {
						continue;
					}
					const transformed = callbacks.get(registration.handlerId);
					transformed?.callback({
						event: registration.event,
						id: eventId,
						payload: { workspaceId },
					});
					if (transformed?.once === true) {
						callbacks.delete(registration.handlerId);
					}
				}
			};
			const emitTextSearchWake = (searchId: string): void => {
				for (const [eventId, registration] of eventHandlers) {
					if (registration.event !== "plain://workspace-search-text-wake") {
						continue;
					}
					const transformed = callbacks.get(registration.handlerId);
					transformed?.callback({
						event: registration.event,
						id: eventId,
						payload: { searchId },
					});
					if (transformed?.once === true) {
						callbacks.delete(registration.handlerId);
					}
				}
			};
			const emitUserDataChanged = (
				resource: "settings" | "keybindings",
				revision: number,
			): void => {
				for (const [eventId, registration] of eventHandlers) {
					if (registration.event !== "plain://user-data-changed") continue;
					const transformed = callbacks.get(registration.handlerId);
					transformed?.callback({
						event: registration.event,
						id: eventId,
						payload: { resource, revision },
					});
					if (transformed?.once === true) {
						callbacks.delete(registration.handlerId);
					}
				}
			};
			let nativeCloseRequestSerial = 701;
			const emitNativeCloseRequest = (reason: "close" | "quit"): string => {
				const requestId = `00000000-0000-4000-8000-${(nativeCloseRequestSerial++)
					.toString()
					.padStart(12, "0")}`;
				const payload = { requestId, reason, timeoutMs: 5_000 };
				calls.push({
					command: "__test_emit_native_close__",
					args: { requestId, reason },
				});
				for (const [eventId, registration] of eventHandlers) {
					if (registration.event !== "plain://close-requested") continue;
					const transformed = callbacks.get(registration.handlerId);
					transformed?.callback({
						event: registration.event,
						id: eventId,
						payload,
					});
					if (transformed?.once === true) {
						callbacks.delete(registration.handlerId);
					}
				}
				return requestId;
			};
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: typeof calls;
				__PLAIN_TEST_EMIT_NATIVE_CLOSE__(reason: "close" | "quit"): string;
				__PLAIN_TEST_EXTERNAL_CREATE__(name: string, emitWake: boolean): void;
				__PLAIN_TEST_EXTERNAL_DELETE__(name: string, emitWake: boolean): void;
				__PLAIN_TEST_EXTERNAL_WRITE__(
					name: string,
					content: string,
					emitWake: boolean,
				): void;
				/** `F220` S3: the remote-root analogue of
				 * `__PLAIN_TEST_EXTERNAL_WRITE__` — bumps an already-authorized
				 * remote root's file version out from under the frontend, bypassing
				 * IPC entirely, with no watcher wake (a remote root has none; only
				 * `Plain: Refresh Remote Folder` rescans it). */
				__PLAIN_TEST_EXTERNAL_WRITE_REMOTE__(
					targetRootId: string,
					relativePath: string,
					content: string,
				): void;
				/** `F220` S3: the remote-root analogue of
				 * `__PLAIN_TEST_EXTERNAL_CREATE__` — adds a new entry directly to an
				 * already-authorized remote root's tree, bypassing IPC and any
				 * watcher wake, so a test can prove `Plain: Refresh Remote Folder`
				 * really does drive a fresh `workspace_read_dir` rather than reading
				 * from a stale cache. */
				__PLAIN_TEST_EXTERNAL_CREATE_REMOTE__(
					targetRootId: string,
					relativePath: string,
					kind: "file" | "directory",
				): void;
				/** `F220` S3 — every remote root this mock has authorized so far
				 * (via `remote_workspace_add_root`), in authorization order; mirrors
				 * `__PLAIN_TEST_DEBUG_SESSION_IDS__`'s identical "expose otherwise
				 * server-generated ids back to the test" shape. */
				__PLAIN_TEST_REMOTE_ROOT_IDS__(): readonly string[];
				/** `F220` S4: simulates the live SSH connection going away on its
				 * own (the peer closed it, or the transport hit a network/protocol
				 * error) — no-op for a `sessionId` that is not or no longer live.
				 * See `simulateRemoteTransportClosed`'s own doc comment. */
				__PLAIN_TEST_SIMULATE_REMOTE_TRANSPORT_CLOSED__(
					sessionId: string,
				): void;
				/** `F220` S4: flips a specific `(host, port)` target's live
				 * fingerprint to the "changed" one *at runtime*, from whatever
				 * point in the test this is called — unlike the static
				 * `changedHostKeyTargetsForTest` fixture option (present from this
				 * closure's very first `remote_session_connect` call), this lets a
				 * test first connect and authorize a real root against the
				 * *original* identity, then simulate the host being reinstalled
				 * partway through (e.g. right before a reconnect attempt). See
				 * `changedHostKeyTargetsRuntime`'s own doc comment. */
				__PLAIN_TEST_MARK_HOST_KEY_CHANGED__(host: string, port: number): void;
				__PLAIN_TEST_EMIT_DEBUG_EVENT__(
					sessionId: string,
					event: string,
					body: unknown,
				): void;
				__PLAIN_TEST_DEBUG_SESSION_IDS__(): readonly string[];
				__TAURI_EVENT_PLUGIN_INTERNALS__: {
					unregisterListener(): void;
				};
				__TAURI_INTERNALS__: {
					invoke(
						command: string,
						args?: Record<string, unknown> | Uint8Array,
					): Promise<unknown>;
					transformCallback(
						callback?: (payload: unknown) => void,
						once?: boolean,
					): number;
					unregisterCallback(callbackId: number): void;
				};
			};
			testWindow.__PLAIN_TEST_TAURI_CALLS__ = calls;
			testWindow.__PLAIN_TEST_EMIT_NATIVE_CLOSE__ = emitNativeCloseRequest;
			testWindow.__PLAIN_TEST_EXTERNAL_CREATE__ = (name, shouldEmitWake) => {
				if (
					!/^[A-Za-z0-9._-]+$/u.test(name) ||
					root.entries.has(name) ||
					typeof shouldEmitWake !== "boolean"
				) {
					throw new Error("Invalid external workspace test change.");
				}
				root.entries.set(name, file(`external:${name}\n`));
				watchDirty = true;
				promoteWatchDirty();
				if (shouldEmitWake) {
					emitWatchWake();
				}
			};
			testWindow.__PLAIN_TEST_EXTERNAL_DELETE__ = (name, shouldEmitWake) => {
				if (
					!/^[A-Za-z0-9._-]+$/u.test(name) ||
					typeof shouldEmitWake !== "boolean"
				) {
					throw new Error("Invalid external workspace test change.");
				}
				deleteNode(name);
				watchDirty = true;
				promoteWatchDirty();
				if (shouldEmitWake) {
					emitWatchWake();
				}
			};
			testWindow.__PLAIN_TEST_EXTERNAL_WRITE__ = (
				name,
				content,
				shouldEmitWake,
			) => {
				if (
					!/^[A-Za-z0-9._-]+$/u.test(name) ||
					typeof content !== "string" ||
					typeof shouldEmitWake !== "boolean"
				) {
					throw new Error("Invalid external workspace test change.");
				}
				const existing = root.entries.get(name);
				if (existing === undefined || existing.kind !== "file") {
					throw new Error("Invalid external workspace test change.");
				}
				existing.bytes = encoder.encode(content);
				existing.version = nextVersion();
				watchDirty = true;
				promoteWatchDirty();
				if (shouldEmitWake) {
					emitWatchWake();
				}
			};
			const themePackages = new Map<string, TestThemePackageSummary>();
			const themeResourceContents = new Map<string, Map<string, string>>();
			const seedThemePackage = (fixture: TestThemePackageFixture): void => {
				themePackages.set(fixture.summary.id, fixture.summary);
				themeResourceContents.set(
					fixture.summary.id,
					new Map(Object.entries(fixture.resourceContents)),
				);
			};
			for (const fixture of themeLibraryFixtureForTest) {
				seedThemePackage(fixture);
			}
			let themeSelection: string | null = themeSelectionForTest;
			let fileIconThemeSelection: string | null = fileIconThemeSelectionForTest;
			let productIconThemeSelection: string | null =
				productIconThemeSelectionForTest;
			const scriptedThemeImports = [...themeImportOutcomesForTest];
			const themeImportFromScript = (): unknown => {
				const outcome = scriptedThemeImports.shift();
				if (outcome === undefined || outcome.status === "cancelled") {
					return { status: "cancelled" };
				}
				if (outcome.status === "failed") {
					throw { code: outcome.code, message: outcome.message };
				}
				seedThemePackage(outcome.fixture);
				return { status: "imported", package: outcome.fixture.summary };
			};
			const themeResourceNotFound = () => ({
				code: "THEME_RESOURCE_NOT_FOUND",
				message: "The requested theme package resource is not available.",
			});

			// --- F070 "WebView DOM 渲染 + trust UX": deterministic fake PTY ---
			// A from-scratch fake mirroring `app/platform/tauri/browser-mock.ts`'s
			// own `BrowserMockTerminalSessionController` *semantics* (session
			// state, echo behavior, frame-level single-outstanding-frame
			// backpressure) rather than reusing that module directly — this
			// fixture drives the real `native.ts` transport (base64 events,
			// `terminal-codec.ts` decode) the same way every other domain here
			// does, not the browser-mock fallback path `createBridge()` only
			// takes when `__TAURI_INTERNALS__` is entirely absent.
			let terminalTrusted = terminalTrustedForTest;
			interface FakeTerminalSession {
				sessionId: string;
				cols: number;
				rows: number;
				lines: string[];
				// F070 "多 tab/split/scrollback": lines that have scrolled off the
				// top of the visible grid, oldest first (index 0 = oldest
				// retained line) — mirrors `src-tauri/src/terminal/vt.rs`'s
				// `VtSession::scrollback_rows` "0 = oldest retained line"
				// convention, so `terminal_scrollback` here can serve real,
				// order-correct historical content rather than always `[]`.
				scrollback: string[];
				cursorCol: number;
				cursorRow: number;
				nextSequence: number;
				awaitingAck: boolean;
				pendingEmit: boolean;
				// `F190` S4 "Ghostty metadata and links": the session's current
				// OSC 7 pwd (already root-relative — mirrors
				// `TerminalFrame.pwd`'s own doc comment), per-cell OSC 8
				// hyperlink/OSC 133 semantic classification (keyed
				// `"<row>:<col>"`), and per-row OSC 133 semantic prompt
				// classification — all scripted only via
				// `__PLAIN_TEST_TERMINAL_SET_METADATA__` below; this fixture
				// never derives them from typed/pushed text itself.
				pwd: string | null;
				hyperlinks: Map<string, string>;
				semantics: Map<string, "output" | "input" | "prompt">;
				rowSemanticPrompts: Map<number, "none" | "prompt" | "continuation">;
				// `F190` S6 "真实 exit banner": guards `emitTerminalExit` so it
				// only ever fires once per session, mirroring the real one-shot
				// `plain://terminal-exit` contract (and
				// `BrowserMockTerminalSessionController.finish`'s own identical
				// guard in `app/platform/tauri/browser-mock.ts`).
				exited: boolean;
			}
			const terminalSessions = new Map<string, FakeTerminalSession>();
			let terminalSessionSerial = 401;
			let lastStartedTerminalSessionId: string | undefined;
			const nextTerminalSessionId = (): string =>
				`00000000-0000-4000-8000-${(terminalSessionSerial++)
					.toString()
					.padStart(12, "0")}`;
			const DEFAULT_TERMINAL_STYLE = Object.freeze({
				bold: false,
				italic: false,
				faint: false,
				blink: false,
				inverse: false,
				invisible: false,
				strikethrough: false,
				overline: false,
				underline: "none",
			});
			function terminalFrameValue(session: FakeTerminalSession): unknown {
				return {
					dirty: "full",
					cols: session.cols,
					rows: session.rows,
					cursor: {
						visible: true,
						blinking: false,
						viewport: {
							x: session.cursorCol,
							y: session.cursorRow,
							atWideTail: false,
						},
						style: "block",
					},
					colors: {
						background: { r: 0, g: 0, b: 0 },
						foreground: { r: 229, g: 229, b: 229 },
						cursor: null,
					},
					rowsData: session.lines.map((line, rowIndex) => ({
						rowIndex,
						semanticPrompt: session.rowSemanticPrompts.get(rowIndex) ?? "none",
						cells: Array.from({ length: session.cols }, (_unused, col) => ({
							graphemes: line[col] ?? "",
							fg: null,
							bg: null,
							style: DEFAULT_TERMINAL_STYLE,
							hyperlink: session.hyperlinks.get(`${rowIndex}:${col}`) ?? null,
							semantic: session.semantics.get(`${rowIndex}:${col}`) ?? "output",
						})),
					})),
					pwd: session.pwd,
				};
			}
			function emitTerminalFrame(session: FakeTerminalSession): void {
				const sequence = session.nextSequence;
				session.nextSequence += 1;
				const payload = {
					sessionId: session.sessionId,
					sequence,
					frame: terminalFrameValue(session),
				};
				for (const [eventId, registration] of eventHandlers) {
					if (registration.event !== "plain://terminal-data") {
						continue;
					}
					const transformed = callbacks.get(registration.handlerId);
					transformed?.callback({
						event: registration.event,
						id: eventId,
						payload,
					});
					if (transformed?.once === true) {
						callbacks.delete(registration.handlerId);
					}
				}
			}
			function emitTerminalExit(
				session: FakeTerminalSession,
				exitCode: number,
				signal: string | null = null,
			): void {
				if (session.exited) {
					return;
				}
				session.exited = true;
				const payload = { sessionId: session.sessionId, exitCode, signal };
				for (const [eventId, registration] of eventHandlers) {
					if (registration.event !== "plain://terminal-exit") {
						continue;
					}
					const transformed = callbacks.get(registration.handlerId);
					transformed?.callback({
						event: registration.event,
						id: eventId,
						payload,
					});
					if (transformed?.once === true) {
						callbacks.delete(registration.handlerId);
					}
				}
			}
			function requestTerminalEmit(session: FakeTerminalSession): void {
				if (session.awaitingAck) {
					session.pendingEmit = true;
					return;
				}
				session.awaitingAck = true;
				session.pendingEmit = false;
				emitTerminalFrame(session);
			}
			// F070 "多 tab/split/scrollback": when the cursor would advance past
			// the last visible row, a real terminal scrolls the whole grid up
			// by one line rather than clamping — the line that falls off the
			// top becomes one more retained `scrollback` entry. This is what
			// lets this fixture's `terminal_scrollback` return real, order-
			// correct historical content instead of always `[]`.
			function terminalScrollUpOneLine(session: FakeTerminalSession): void {
				const [oldest, ...rest] = session.lines;
				session.scrollback.push(oldest ?? "");
				session.lines = [...rest, ""];
			}
			function terminalAdvanceRow(session: FakeTerminalSession): void {
				if (session.cursorRow >= session.rows - 1) {
					terminalScrollUpOneLine(session);
					return;
				}
				session.cursorRow += 1;
			}
			function terminalAppendText(
				session: FakeTerminalSession,
				text: string,
			): void {
				for (const character of text) {
					if (character === "\n" || character === "\r") {
						terminalAdvanceRow(session);
						session.cursorCol = 0;
						continue;
					}
					const line = session.lines[session.cursorRow] ?? "";
					session.lines[session.cursorRow] =
						line.slice(0, session.cursorCol) +
						character +
						line.slice(session.cursorCol + 1);
					session.cursorCol += 1;
					if (session.cursorCol >= session.cols) {
						session.cursorCol = 0;
						terminalAdvanceRow(session);
					}
				}
			}
			function terminalBackspace(session: FakeTerminalSession): void {
				if (session.cursorCol === 0) {
					return;
				}
				session.cursorCol -= 1;
				const line = session.lines[session.cursorRow] ?? "";
				session.lines[session.cursorRow] =
					line.slice(0, session.cursorCol) + line.slice(session.cursorCol + 1);
			}
			function terminalNotTrusted() {
				return {
					code: "WORKSPACE_NOT_TRUSTED",
					message: "This workspace has not been granted execution trust.",
				};
			}
			// `F190` S2 "future-tab defaults UI": mirrors
			// `src-tauri/src/terminal/mod.rs`'s own `terminal_profile_invalid`/
			// `terminal_cwd_invalid` — same code/message — so a Browser test can
			// exercise the exact accurate, absolute-path-free status text
			// `TerminalPaneController` shows via `normalizeCommandError`.
			function terminalProfileInvalid() {
				return {
					code: "TERMINAL_PROFILE_INVALID",
					message:
						"The requested terminal profile is not available on this computer.",
				};
			}
			function terminalCwdInvalid() {
				return {
					code: "TERMINAL_CWD_INVALID",
					message:
						"The requested working directory is not inside an authorized workspace root.",
				};
			}
			function gitNoRepository() {
				return {
					code: "GIT_NO_REPOSITORY",
					message: "The current workspace root is not a Git repository.",
				};
			}

			// --- `F100` S3: real session-lifecycle + interactive debugging mock. ---
			const debugAdapterConfirmations = new Set<string>();
			// `F220` S7 — `confirmRootId` folds in the requested root's own
			// remote identity (the bound session's `hostKeyFingerprint`, `null`
			// for the native root or an unrecognized id), mirroring
			// `src-tauri/src/debug/dto.rs`'s
			// `AdapterConfirmationSubject::remote_host_fingerprint`: a command
			// confirmed for the native root must never be treated as already
			// confirmed for a remote one, or vice versa.
			function debugAdapterConfirmationKey(
				request: {
					command?: string;
					args?: readonly string[];
					transport?: string;
				},
				confirmRootId?: string,
			): string {
				return JSON.stringify([
					request.command,
					request.args,
					request.transport,
					confirmRootId === undefined
						? null
						: (remoteRootBindings.get(confirmRootId)?.hostKeyFingerprint ??
							null),
				]);
			}
			function debugAdapterNotConfirmed() {
				return {
					code: "DEBUG_ADAPTER_NOT_CONFIRMED",
					message:
						"This exact adapter command has not been confirmed for this workspace yet.",
				};
			}
			function debugSessionNotFound() {
				return {
					code: "DEBUG_SESSION_NOT_FOUND",
					message:
						"The requested debug session does not exist for this window.",
				};
			}
			// `F210` S6 — the two spawn-then-connect failure codes
			// `src-tauri/src/debug/mod.rs`'s
			// `debug_adapter_tcp_companion_exited`/
			// `debug_adapter_tcp_companion_connect_timed_out` report; mirrors
			// `app/platform/tauri/browser-mock.ts`'s own identical pair.
			function debugAdapterTcpCompanionExited() {
				return {
					code: "DEBUG_ADAPTER_TCP_COMPANION_EXITED",
					message:
						"The spawned debug adapter process exited before Plain could connect to its TCP listener.",
				};
			}
			function debugAdapterTcpCompanionConnectTimedOut() {
				return {
					code: "DEBUG_ADAPTER_TCP_COMPANION_CONNECT_TIMED_OUT",
					message:
						"Timed out waiting for the spawned debug adapter's TCP listener to become ready.",
				};
			}
			function debugRootNotAuthorized() {
				return {
					code: "ROOT_NOT_AUTHORIZED",
					message:
						"The requested workspace root is not authorized for this window.",
				};
			}
			// `F220` S7 — mirrors `src-tauri/src/debug/mod.rs`'s
			// `debug_remote_transport_unsupported`.
			function debugRemoteTransportUnsupported() {
				return {
					code: "DEBUG_REMOTE_TRANSPORT_UNSUPPORTED",
					message:
						"TCP and TCP-spawn debug adapter transports are not supported for a remote workspace root; only the stdio (exec-channel) transport is supported.",
				};
			}
			// `F100` S4: the adversarial "step request issued while the session
			// is not stopped" scenario — mirrors the real, spec-grounded
			// rejection `src-tauri/src/debug/service/tests.rs`'s own
			// `step_control_commands_send_their_own_distinct_dap_command_and_surface_a_not_stopped_rejection`
			// exercises against a real spawned mock adapter.
			function debugRequestFailedNotStopped(command: string) {
				return {
					code: "DEBUG_REQUEST_FAILED",
					message: `The debug adapter rejected the '${command}' request: not stopped.`,
				};
			}
			const liveDebugSessions = new Set<string>();
			const debugSessionRoots = new Map<string, string>();
			let debugSessionSerial = 601;
			const nextDebugSessionId = (): string =>
				`00000000-0000-4000-8000-${(debugSessionSerial++)
					.toString()
					.padStart(12, "0")}`;
			function emitDebugEvent(
				sessionId: string,
				event: string,
				body: unknown,
			): void {
				const payload = { sessionId, event, body };
				for (const [eventId, registration] of eventHandlers) {
					if (registration.event !== "plain://debug-event") {
						continue;
					}
					const transformed = callbacks.get(registration.handlerId);
					transformed?.callback({
						event: registration.event,
						id: eventId,
						payload,
					});
					if (transformed?.once === true) {
						callbacks.delete(registration.handlerId);
					}
				}
			}
			// Test-only escape hatch (mirrors `__PLAIN_TEST_EXTERNAL_CREATE__` etc.
			// above) letting a Playwright test push a synthetic DAP event (most
			// commonly `stopped`) for a live mock session, exactly as a real
			// adapter would over `plain://debug-event` — this is what lets a test
			// exercise the call-stack view's real "`stopped` drives a refresh"
			// wiring without a real adapter process.
			testWindow.__PLAIN_TEST_EMIT_DEBUG_EVENT__ = (sessionId, event, body) => {
				if (typeof sessionId !== "string" || typeof event !== "string") {
					throw new Error("Invalid debug event test injection.");
				}
				emitDebugEvent(sessionId, event, body);
			};
			testWindow.__PLAIN_TEST_DEBUG_SESSION_IDS__ = () => [
				...liveDebugSessions,
			];
			// `F220` S1 — the mock's own in-memory SSH known-hosts pin store and
			// live session table, mirroring `app/platform/tauri/browser-mock.ts`'s
			// own identical design (see that file's `remoteMockTargetKey`/
			// `remoteMockFingerprint`/`remoteMockDigest` for the byte-for-byte
			// twin of this logic).
			let remoteSessionSerial = 901;
			const nextRemoteSessionId = (): string =>
				`00000000-0000-4000-8000-${(remoteSessionSerial++)
					.toString()
					.padStart(12, "0")}`;
			function remoteMockTargetKey(host: string, port: number): string {
				return `${host}:${port}`;
			}
			function remoteMockDigest(input: string): string {
				let hash = 0x811c9dc5;
				for (let index = 0; index < input.length; index += 1) {
					hash ^= input.charCodeAt(index);
					hash = Math.imul(hash, 0x01000193);
				}
				return (hash >>> 0).toString(16).padStart(8, "0");
			}
			function remoteMockFingerprint(
				host: string,
				port: number,
				changed: boolean,
			): string {
				const digest = remoteMockDigest(
					`${host}:${port}${changed ? ":changed" : ""}`,
				);
				return `SHA256:${digest.repeat(6)}`;
			}
			const remoteKnownHosts = new Map<
				string,
				{ algorithm: string; sha256Fingerprint: string }
			>();
			for (const target of remoteFixtureForTest.pinnedHostsForTest ?? []) {
				remoteKnownHosts.set(remoteMockTargetKey(target.host, target.port), {
					algorithm: "ssh-ed25519",
					sha256Fingerprint: remoteMockFingerprint(
						target.host,
						target.port,
						false,
					),
				});
			}
			// `F220` S4: `changedHostKeyTargetsForTest` is a *static* fixture
			// option, present for a target from the very first `remote_session_connect`
			// call this closure ever handles — correct for modeling "this mock
			// server has always been lying about its identity" (S1's own hard-fail
			// test), but unable to model "a host was reinstalled *partway through*
			// a test" (needed for a reconnect-time hard-fail after an already-
			// successful earlier connect authorized a real root). This mutable set
			// starts seeded from that static list and gains a runtime-only escape
			// hatch (`__PLAIN_TEST_MARK_HOST_KEY_CHANGED__` below) a test can call
			// mid-run, once a root is already authorized, to flip a specific
			// target's live fingerprint out from under an *already-pinned* host —
			// every read of "is this target's live fingerprint the changed one"
			// goes through this set, never the static fixture field directly.
			const changedHostKeyTargetsRuntime = new Set<string>(
				remoteFixtureForTest.changedHostKeyTargetsForTest ?? [],
			);
			// `F220` S4: `hostKeyFingerprint` is captured once at connect time —
			// the live fingerprint this exact session was authenticated under.
			// `remote_workspace_reconnect_root` reads it off the *new* session to
			// compare against a root's originally recorded identity (mirrors the
			// real `RemoteSessionService::session_host_key_fingerprint`).
			const remoteSessions = new Map<
				string,
				{
					host: string;
					port: number;
					user: string;
					hostKeyFingerprint: string;
				}
			>();
			// `F220` S3 — a second, independent "remote filesystem" the mock
			// serves purely in-memory: `remoteWorkspaceTree` is what
			// `remote_workspace_pick_directory` browses (unconfined, mirrors real
			// SFTP browsing before any root is authorized), and
			// `remoteRootTrees` holds one entry per root a test has actually
			// authorized via `remote_workspace_add_root`, each pointing at the
			// exact subtree `remoteWorkspaceTree` had at that path — from then on
			// every `workspace_*` case dispatches to it exactly like the fixed
			// native `root` tree, via `treeForRootId` below.
			function buildRemoteWorkspaceTree(
				flat: Readonly<
					Record<string, "directory" | Readonly<{ content: string }>>
				>,
			): MockDirectory {
				const tree: MockDirectory = directory([]);
				const sortedPaths = Object.keys(flat).sort(
					(left, right) => left.split("/").length - right.split("/").length,
				);
				for (const absolutePath of sortedPaths) {
					const segments = absolutePath.split("/").filter((s) => s.length > 0);
					if (segments.length === 0) {
						continue;
					}
					let parent = tree;
					for (const segment of segments.slice(0, -1)) {
						const next = parent.entries.get(segment);
						if (next === undefined || next.kind !== "directory") {
							throw new Error(
								"Invalid remote directoryTreeForTest: missing ancestor directory.",
							);
						}
						parent = next;
					}
					const leafName = segments.at(-1)!;
					const spec = flat[absolutePath]!;
					parent.entries.set(
						leafName,
						spec === "directory" ? directory([]) : file(spec.content),
					);
				}
				return tree;
			}
			const remoteWorkspaceTree = buildRemoteWorkspaceTree(
				remoteFixtureForTest.directoryTreeForTest ?? {
					"/home": "directory",
					"/home/octocat": "directory",
					"/home/octocat/project": "directory",
					"/home/octocat/project/main.ts": {
						content: "export const remoteMain = true;\n",
					},
					"/home/octocat/scratch": "directory",
				},
			);
			function remoteWorkspaceDirectoryAt(absolutePath: string): MockDirectory {
				const segments = absolutePath.split("/").filter((s) => s.length > 0);
				let node: MockNode = remoteWorkspaceTree;
				for (const segment of segments) {
					if (node.kind !== "directory") {
						throw entryTypeMismatch();
					}
					const child = node.entries.get(segment);
					if (child === undefined) {
						throw entryNotFound();
					}
					node = child;
				}
				if (node.kind !== "directory") {
					throw entryTypeMismatch();
				}
				return node;
			}
			function remoteNormalizePath(path: string): string {
				const segments = path.split("/").filter((s) => s.length > 0);
				return segments.length === 0 ? "/" : `/${segments.join("/")}`;
			}
			const remoteRootTrees = new Map<string, MockDirectory>();
			// `F220` S4: every currently-authorized remote root's own fixed
			// identity (`hostKeyFingerprint`/`basePath`, captured once at
			// authorization and never touched by a reconnect — mirrors
			// `WorkspaceScope::reconnect_remote_root`'s own "only `sessionId`
			// moves" contract) plus its *current* `sessionId` binding, which does
			// move. Populated alongside `remoteRootTrees` in
			// `remote_workspace_add_root`; both `treeForRootId` (session
			// liveness) and `remote_workspace_reconnect_root` read it.
			const remoteRootBindings = new Map<
				string,
				{ sessionId: string; hostKeyFingerprint: string; basePath: string }
			>();
			let remoteRootSerial = 601;
			const nextRemoteRootId = (): string =>
				`00000000-0000-4000-8000-${(remoteRootSerial++)
					.toString()
					.padStart(12, "0")}`;
			function remoteSessionDisconnected() {
				return {
					code: "REMOTE_SESSION_DISCONNECTED",
					message:
						"The SSH session backing this workspace root is no longer connected.",
				};
			}
			function treeForRootId(id: string | undefined): MockDirectory {
				if (id === rootId) {
					return root;
				}
				const remoteTree =
					id === undefined ? undefined : remoteRootTrees.get(id);
				if (remoteTree !== undefined) {
					// `F220` S4 (ADR 0006 §5): an FS operation against an
					// already-authorized remote root whose bound session has since
					// disconnected (`Disconnected{reason:"transportClosed"}`, or an
					// explicit `remote_session_disconnect`) fails closed — distinct
					// from `REMOTE_SESSION_NOT_FOUND` (a `sessionId` that never
					// existed at all), mirroring `remote::remote_session_disconnected()`'s
					// own doc comment for why the two are never conflated.
					const binding =
						id === undefined ? undefined : remoteRootBindings.get(id);
					if (binding !== undefined && !remoteSessions.has(binding.sessionId)) {
						throw remoteSessionDisconnected();
					}
					return remoteTree;
				}
				throw entryNotFound();
			}
			function remoteDisplayNameFor(canonicalPath: string): string {
				const segments = canonicalPath.split("/").filter((s) => s.length > 0);
				return segments.at(-1) ?? "remote";
			}
			function remoteRequestInvalid() {
				return {
					code: "REMOTE_REQUEST_INVALID",
					message: "The remote workspace request is invalid.",
				};
			}
			function remoteNotADirectory() {
				return {
					code: "ENTRY_TYPE_MISMATCH",
					message: "The remote entry has an incompatible type.",
				};
			}
			// `F220` S4 (ADR 0007 §4): Recent-entry tracking for this fixture's
			// own single fixed native root plus any authorized remote root(s) —
			// mirrors `installMultiRootNativeIpcMock`'s own `recentEntries`/
			// `recordRecent()` shape, extended with a `remoteRoots` field neither
			// that mock nor this fixture's own pre-`F220`-S4 static
			// `workspace_recent_list` ever modeled. Round-trips through
			// `sessionStorage` (like `backupEntries` above) so a `page.reload()`
			// genuinely simulates a cold start against a real "last workspace",
			// not just re-running this closure from scratch with the same static
			// fixtures.
			const RECENT_STORAGE_KEY = "__plain_test_recent_store__";
			interface StoredRecentRemoteRoot {
				readonly host: string;
				readonly port: number;
				readonly user: string;
				readonly path: string;
				readonly label: string;
			}
			interface StoredRecentEntry {
				readonly recentId: string;
				readonly label: string;
				readonly hasLocalRoot: boolean;
				readonly remoteRoots: readonly StoredRecentRemoteRoot[];
			}
			interface StoredRecentState {
				entries: StoredRecentEntry[];
				revision: number;
				lastRecentId: string | null;
			}
			const loadRecentState = (): StoredRecentState => {
				const raw = sessionStorage.getItem(RECENT_STORAGE_KEY);
				if (raw === null) {
					return { entries: [], revision: 1, lastRecentId: null };
				}
				try {
					const parsed = JSON.parse(raw) as StoredRecentState;
					return {
						entries: Array.isArray(parsed.entries) ? parsed.entries : [],
						revision: typeof parsed.revision === "number" ? parsed.revision : 1,
						lastRecentId:
							typeof parsed.lastRecentId === "string"
								? parsed.lastRecentId
								: null,
					};
				} catch {
					return { entries: [], revision: 1, lastRecentId: null };
				}
			};
			const recentState = loadRecentState();
			const persistRecentState = (): void => {
				sessionStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(recentState));
			};
			let recentIdSerial = 701;
			const nextRecentId = (): string =>
				`00000000-0000-4000-8000-${(recentIdSerial++)
					.toString(16)
					.padStart(12, "0")}`;
			const recentRemoteIdentityKey = (entry: StoredRecentRemoteRoot): string =>
				`${entry.host}\0${entry.port}\0${entry.user}\0${entry.path}`;
			// Called after every root-set-changing mutation
			// (`workspace_pick_roots`, `remote_workspace_add_root`,
			// `workspace_open_recent`) — mirrors
			// `workspace::commands::record_current_workspace`'s own two-backend
			// recording contract, including its "silently skip a remote root
			// whose session has already disconnected" degrade path.
			function recordRecent(): void {
				const hasLocalRoot = currentSnapshot.roots.some(
					(candidate) => candidate.rootId === rootId,
				);
				const remoteRootsNow: StoredRecentRemoteRoot[] = [];
				for (const candidateRoot of currentSnapshot.roots) {
					if (candidateRoot.rootId === rootId) {
						continue;
					}
					const binding = remoteRootBindings.get(candidateRoot.rootId);
					if (binding === undefined) {
						continue;
					}
					const session = remoteSessions.get(binding.sessionId);
					if (session === undefined) {
						continue;
					}
					remoteRootsNow.push({
						host: session.host,
						port: session.port,
						user: session.user,
						path: binding.basePath,
						label: candidateRoot.displayName,
					});
				}
				recentState.revision += 1;
				if (!hasLocalRoot && remoteRootsNow.length === 0) {
					recentState.lastRecentId = null;
					persistRecentState();
					return;
				}
				const currentRemoteIdentities = remoteRootsNow.map(
					recentRemoteIdentityKey,
				);
				const existingIndex = recentState.entries.findIndex(
					(entry) =>
						entry.hasLocalRoot === hasLocalRoot &&
						entry.remoteRoots.length === remoteRootsNow.length &&
						entry.remoteRoots.every(
							(candidate, index) =>
								recentRemoteIdentityKey(candidate) ===
								currentRemoteIdentities[index],
						),
				);
				const recentId =
					existingIndex >= 0
						? recentState.entries.splice(existingIndex, 1)[0]!.recentId
						: nextRecentId();
				const rootLabels = hasLocalRoot ? ["native-workspace"] : [];
				const allLabels = [
					...rootLabels,
					...remoteRootsNow.map((entry) => entry.label),
				];
				const label =
					allLabels.length <= 1
						? (allLabels[0] ?? "Empty Workspace")
						: `${allLabels[0]} + ${allLabels.length - 1} folders`;
				recentState.entries.unshift({
					recentId,
					label,
					hasLocalRoot,
					remoteRoots: remoteRootsNow,
				});
				recentState.entries = recentState.entries.slice(0, 20);
				recentState.lastRecentId = recentId;
				persistRecentState();
			}
			testWindow.__PLAIN_TEST_EXTERNAL_WRITE_REMOTE__ = (
				targetRootId,
				relativePath,
				content,
			) => {
				const tree = remoteRootTrees.get(targetRootId);
				if (tree === undefined || typeof content !== "string") {
					throw new Error("Invalid external remote workspace test change.");
				}
				const existing = resolveNode(relativePath, tree);
				if (existing.kind !== "file") {
					throw new Error("Invalid external remote workspace test change.");
				}
				existing.bytes = encoder.encode(content);
				existing.version = nextVersion();
			};
			testWindow.__PLAIN_TEST_EXTERNAL_CREATE_REMOTE__ = (
				targetRootId,
				relativePath,
				kind,
			) => {
				const tree = remoteRootTrees.get(targetRootId);
				if (tree === undefined) {
					throw new Error("Invalid external remote workspace test change.");
				}
				const { parent, name } = resolveParent(relativePath, tree);
				if (parent.entries.has(name)) {
					throw new Error("Invalid external remote workspace test change.");
				}
				parent.entries.set(
					name,
					kind === "file" ? file(`external:${name}\n`) : directory([]),
				);
			};
			testWindow.__PLAIN_TEST_REMOTE_ROOT_IDS__ = () => [
				...remoteRootTrees.keys(),
			];
			function remoteAgentAuthRejected() {
				return {
					code: "REMOTE_AGENT_AUTH_REJECTED",
					message: "The server rejected every identity the SSH agent offered.",
				};
			}
			function remoteConnectTimedOut() {
				return {
					code: "REMOTE_CONNECT_TIMED_OUT",
					message:
						"Timed out waiting to establish an SSH connection to the requested host.",
				};
			}
			function remoteHostKeyChanged(
				host: string,
				port: number,
				algorithm: string,
				oldFingerprint: string,
				newFingerprint: string,
			) {
				return {
					code: "REMOTE_HOST_KEY_CHANGED",
					message:
						`The host key for ${host}:${port} has changed. Previously pinned (${algorithm}): ` +
						`${oldFingerprint}. Now offered: ${newFingerprint}. This may indicate the host was ` +
						"reinstalled or a man-in-the-middle attack; the existing pin must be explicitly " +
						"forgotten (Plain: Forget SSH Host Key…) before reconnecting.",
				};
			}
			function remoteSessionNotFound() {
				return {
					code: "REMOTE_SESSION_NOT_FOUND",
					message: "The requested SSH session does not exist for this window.",
				};
			}
			function emitRemoteSessionEvent(payload: Record<string, unknown>): void {
				for (const [eventId, registration] of eventHandlers) {
					if (registration.event !== "plain://remote-session-event") {
						continue;
					}
					const transformed = callbacks.get(registration.handlerId);
					transformed?.callback({
						event: registration.event,
						id: eventId,
						payload,
					});
					if (transformed?.once === true) {
						callbacks.delete(registration.handlerId);
					}
				}
			}
			function remoteCompleteConnect(
				host: string,
				port: number,
				user: string,
			): Record<string, unknown> {
				const outcome =
					remoteFixtureForTest.connectOutcomesForTest?.[
						remoteMockTargetKey(host, port)
					] ?? "success";
				if (outcome === "authRejected") {
					throw remoteAgentAuthRejected();
				}
				if (outcome === "connectTimedOut") {
					throw remoteConnectTimedOut();
				}
				const sessionId = nextRemoteSessionId();
				const key = remoteMockTargetKey(host, port);
				const changed = changedHostKeyTargetsRuntime.has(key);
				const hostKeyFingerprint = remoteMockFingerprint(host, port, changed);
				remoteSessions.set(sessionId, {
					host,
					port,
					user,
					hostKeyFingerprint,
				});
				emitRemoteSessionEvent({
					event: "connected",
					sessionId,
					host,
					port,
					user,
				});
				return { status: "connected", sessionId };
			}
			// `F220` S4 — a *reactive* disconnect: unlike `remote_session_disconnect`
			// (an explicit `Plain: Disconnect SSH Session…`-driven, always
			// `"userRequested"` teardown a test drives through the ordinary
			// command surface), this is a test-only escape hatch with no wire
			// command equivalent — there is no command for "the peer hung up on
			// us"; Rust's own reactive counterpart
			// (`session::RemoteClientHandler::disconnected`) is a
			// `russh::client::Handler` callback with nothing for the frontend to
			// call. Mirrors `__PLAIN_TEST_EMIT_DEBUG_EVENT__`'s own "test-only
			// escape hatch exposed on `testWindow`" shape for a different domain.
			// A no-op for a `sessionId` that is not (or no longer) live.
			function simulateRemoteTransportClosed(sessionId: string): void {
				const session = remoteSessions.get(sessionId);
				if (session === undefined) {
					return;
				}
				remoteSessions.delete(sessionId);
				emitRemoteSessionEvent({
					event: "disconnected",
					sessionId,
					host: session.host,
					port: session.port,
					user: session.user,
					reason: "transportClosed",
				});
			}
			testWindow.__PLAIN_TEST_SIMULATE_REMOTE_TRANSPORT_CLOSED__ = (
				sessionId: string,
			) => {
				if (typeof sessionId !== "string") {
					throw new Error("Invalid remote transport-closed test injection.");
				}
				simulateRemoteTransportClosed(sessionId);
			};
			testWindow.__PLAIN_TEST_MARK_HOST_KEY_CHANGED__ = (host, port) => {
				if (typeof host !== "string" || typeof port !== "number") {
					throw new Error("Invalid host-key-changed test injection.");
				}
				changedHostKeyTargetsRuntime.add(remoteMockTargetKey(host, port));
			};
			// Expands this file's own deliberately-terse `TestGitStatusEntry`
			// (`type`/`indexStatus`/`worktreeStatus`/`path`/`origPath` only) into
			// the full `GitStatusEntryWire` shape `git-codec.ts`'s
			// `decodeGitStatusEntry` strictly requires (`hasExactKeys` — an
			// entry missing `submodule`/`modeHead`/`hashHead`/etc. would be
			// rejected as an `IPC_CONTRACT_VIOLATION`, not silently accepted).
			// The filled-in mode/hash/submodule defaults are inert placeholders
			// no scenario in this file inspects.
			function fullGitStatusEntry(entry: TestGitStatusEntry) {
				const submodule = {
					isSubmodule: false,
					commitChanged: false,
					trackedChanged: false,
					untrackedChanged: false,
				};
				if (entry.type === "untracked" || entry.type === "ignored") {
					return { type: entry.type, path: entry.path };
				}
				if (entry.type === "unmerged") {
					return {
						type: "unmerged",
						indexStatus: entry.indexStatus ?? "U",
						worktreeStatus: entry.worktreeStatus ?? "U",
						submodule,
						modeStage1: "100644",
						modeStage2: "100644",
						modeStage3: "100644",
						modeWorktree: "100644",
						hashStage1: "a".repeat(40),
						hashStage2: "b".repeat(40),
						hashStage3: "c".repeat(40),
						path: entry.path,
					};
				}
				if (entry.type === "renameOrCopy") {
					return {
						type: "renameOrCopy",
						indexStatus: entry.indexStatus ?? ".",
						worktreeStatus: entry.worktreeStatus ?? ".",
						submodule,
						modeHead: "100644",
						modeIndex: "100644",
						modeWorktree: "100644",
						hashHead: "a".repeat(40),
						hashIndex: "b".repeat(40),
						renameOrCopyKind: "rename",
						similarity: 100,
						path: entry.path,
						origPath: entry.origPath ?? entry.path,
					};
				}
				return {
					type: "ordinary",
					indexStatus: entry.indexStatus ?? ".",
					worktreeStatus: entry.worktreeStatus ?? ".",
					submodule,
					modeHead: "100644",
					modeIndex: "100644",
					modeWorktree: "100644",
					hashHead: "a".repeat(40),
					hashIndex: "b".repeat(40),
					path: entry.path,
				};
			}

			// --- F080 S3: mutable stage/unstage/commit/discard simulation -----
			//
			// Same simulation shape as `app/platform/tauri/browser-mock.ts`'s own
			// (see that file's identically-named-in-spirit helpers) — reproduced
			// here rather than imported because this fixture drives the real
			// `native.ts` transport directly (see this function's own module doc
			// comment), not `browser-mock.ts`. `mockGitEntries`/`mockGitBranch`
			// start from the static `gitFixtureForTest` and are mutated in place
			// by the five write-command cases below; `git_status` (mutated below
			// to stop returning the static fixture verbatim) always reflects the
			// current mutated state.
			let mockGitBranch = gitFixtureForTest.branch ?? {
				oid: "0".repeat(40),
				head: "main",
				upstream: null,
			};
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			let mockGitEntries: any[] = (gitFixtureForTest.entries ?? []).map(
				fullGitStatusEntry,
			);
			let mockGitCommitCounter = 0;
			const MOCK_ZERO_HASH = "0".repeat(40);
			const MOCK_ZERO_SUBMODULE = {
				isSubmodule: false,
				commitChanged: false,
				trackedChanged: false,
				untrackedChanged: false,
			};

			function gitCommitNothingToCommit() {
				return {
					code: "GIT_COMMIT_NOTHING_TO_COMMIT",
					message: "There are no staged changes to commit.",
				};
			}
			function gitDiscardFailed() {
				return {
					code: "GIT_DISCARD_FAILED",
					message: "git checkout did not complete successfully.",
				};
			}

			// --- F080 S4: mutable fetch/pull/push simulation -------------------
			//
			// Same simulation shape as `app/platform/tauri/browser-mock.ts`'s own
			// `BrowserMockGitNetworkFixtureForTest` — reproduced here rather than
			// imported, for the same reason the S3 stage/unstage/commit/discard
			// simulation above is: this fixture drives the real `native.ts`
			// transport directly, not `browser-mock.ts`.
			let mockGitNetworkUpstream: string | null =
				gitNetworkFixtureForTest.upstream === undefined
					? "origin/main"
					: gitNetworkFixtureForTest.upstream;
			let mockGitNetworkAhead = gitNetworkFixtureForTest.ahead ?? 0;
			let mockGitNetworkBehind = gitNetworkFixtureForTest.behind ?? 0;

			// --- F090 S6: blame/history/commit-detail/graph/refs/stash/worktree
			// simulation ---------------------------------------------------------
			//
			// Same simulation shape as `app/platform/tauri/browser-mock.ts`'s own
			// (see that file's identically-named-in-spirit fixtures) —
			// reproduced here rather than imported for the same reason the F080
			// S3/S4 simulations above are. `stash`/`worktree` are the only two of
			// these seven domains with real writes, so only they need mutable
			// state; the rest are static per-key lookups exactly like
			// `gitFixtureForTest.blobs` above.
			const mockGitBlame = new Map<string, TestGitBlameFileResult>(
				Object.entries(gitFixtureForTest.blame ?? {}),
			);
			const mockGitBlameCommitMessages = new Map<string, string>(
				Object.entries(gitFixtureForTest.blameCommitMessages ?? {}),
			);
			const mockGitFileHistory = new Map<string, TestGitHistoryListResult>(
				Object.entries(gitFixtureForTest.fileHistory ?? {}),
			);
			const mockGitLineHistoryList = new Map<string, TestGitHistoryListResult>(
				Object.entries(gitFixtureForTest.lineHistoryList ?? {}),
			);
			const mockGitLineHistoryDetail = new Map<
				string,
				Readonly<{ sha: string; diffText: string }>
			>(Object.entries(gitFixtureForTest.lineHistoryDetail ?? {}));
			const mockGitShowCommit = new Map<string, TestGitShowCommitResult>(
				Object.entries(gitFixtureForTest.showCommit ?? {}),
			);
			const mockGitCommitBlobs = new Map<
				string,
				Readonly<Record<string, string>>
			>(Object.entries(gitFixtureForTest.commitBlobs ?? {}));
			const mockGitGraph: TestGitLogGraphResult =
				gitFixtureForTest.graphForTest ?? { nodes: [], truncated: false };
			const seededGitRefs = gitFixtureForTest.refsForTest ?? {
				entries: [],
				truncated: false,
			};
			let mockGitRefEntries: TestGitRefEntry[] = seededGitRefs.entries.map(
				(entry) => ({ ...entry }),
			);
			const seededGitRemotes = gitFixtureForTest.remotesForTest ?? {
				entries: [],
				truncated: false,
			};
			let mockGitRemoteEntries: TestGitRemoteEntry[] =
				seededGitRemotes.entries.map((entry) => ({
					...entry,
					fetchUrls: [...entry.fetchUrls],
					pushUrls: [...entry.pushUrls],
				}));
			const mockGitUnmergedBranches = new Set(
				gitFixtureForTest.branchUnmergedForTest ?? [],
			);
			const mockGitReflog: TestGitReflogListResult =
				gitFixtureForTest.reflogForTest ?? {
					entries: [],
					truncated: false,
				};
			const mockGitContributors: TestGitContributorsListResult =
				gitFixtureForTest.contributorsForTest ?? {
					entries: [],
					truncated: false,
				};
			let mockGitHistoryPreviewCounter = 0;
			let mockGitHistoryCommitCounter = 0;
			let mockGitHistorySequencer: Readonly<{
				kind: TestGitSequencerKind;
				conflictedPaths: readonly string[];
				pathsTruncated: boolean;
			}> | null = null;
			let mockGitHistoryPreview:
				| Readonly<{
						operation: TestGitHistoryOperation;
						targetSha: string;
						previewToken: string;
				  }>
				| undefined;
			let mockGitHistoryInFlight:
				{ cancelled: boolean; operation: TestGitHistoryOperation } | undefined;

			function mockGitHistoryState() {
				return {
					headSha: mockGitBranch.oid,
					sequencer:
						mockGitHistorySequencer === null
							? null
							: {
									kind: mockGitHistorySequencer.kind,
									conflictedPaths: [...mockGitHistorySequencer.conflictedPaths],
									pathsTruncated: mockGitHistorySequencer.pathsTruncated,
								},
				};
			}

			function mockGitHistoryPaths() {
				const workingTreePaths: string[] = [];
				const stagedPaths: string[] = [];
				const conflictedPaths: string[] = [];
				for (const entry of mockGitEntries) {
					if (entry.type === "ordinary" || entry.type === "renameOrCopy") {
						if (entry.indexStatus !== ".") stagedPaths.push(entry.path);
						if (entry.worktreeStatus !== ".") workingTreePaths.push(entry.path);
					} else if (entry.type === "unmerged") {
						conflictedPaths.push(entry.path);
					}
				}
				return {
					workingTreePaths,
					stagedPaths,
					conflictedPaths,
					pathsTruncated: false,
				};
			}

			function mockGitSequencerKind(
				operation: TestGitHistoryOperation,
			): TestGitSequencerKind | undefined {
				switch (operation) {
					case "merge":
					case "rebase":
					case "cherryPick":
					case "revert":
						return operation;
					case "resetSoft":
					case "resetMixed":
					case "resetHard":
						return undefined;
				}
			}

			async function executeMockGitHistoryOperation(
				operation: TestGitHistoryOperation,
				targetSha: string,
				previewToken: string,
			) {
				if (
					mockGitHistoryPreview?.operation !== operation ||
					mockGitHistoryPreview.targetSha !== targetSha ||
					mockGitHistoryPreview.previewToken !== previewToken
				) {
					throw {
						code: "GIT_HISTORY_PREVIEW_STALE",
						message:
							"The Git repository changed after the operation preview. Review it again before continuing.",
					};
				}
				if (mockGitHistorySequencer !== null || mockGitHistoryInFlight) {
					throw {
						code: "GIT_HISTORY_OPERATION_IN_PROGRESS",
						message:
							"Finish or abort the current Git operation before starting another one.",
					};
				}
				mockGitHistoryPreview = undefined;
				const inFlight = { cancelled: false, operation };
				mockGitHistoryInFlight = inFlight;
				const delay = gitFixtureForTest.historyDelayMsForTest ?? 0;
				if (delay > 0) {
					await new Promise((resolve) => setTimeout(resolve, delay));
				}
				if (mockGitHistoryInFlight === inFlight) {
					mockGitHistoryInFlight = undefined;
				}
				if (inFlight.cancelled) {
					return { kind: "cancelled", state: mockGitHistoryState() };
				}
				const conflicts =
					gitFixtureForTest.historyConflictForTest?.[operation] ?? [];
				const kind = mockGitSequencerKind(operation);
				if (kind !== undefined && conflicts.length > 0) {
					mockGitHistorySequencer = {
						kind,
						conflictedPaths: conflicts.slice(0, 256),
						pathsTruncated: conflicts.length > 256,
					};
					return { kind: "conflicts", state: mockGitHistoryState() };
				}
				mockGitHistorySequencer = null;
				mockGitHistoryCommitCounter += 1;
				mockGitBranch = {
					...mockGitBranch,
					oid:
						operation.startsWith("reset") || operation === "merge"
							? targetSha
							: mockGitHistoryCommitCounter.toString(16).padStart(40, "0"),
				};
				return { kind: "completed", state: mockGitHistoryState() };
			}

			function mockGitRefsSnapshot(): TestGitRefsListResult {
				return {
					entries: mockGitRefEntries.map((entry) => ({ ...entry })),
					truncated: seededGitRefs.truncated,
				};
			}

			function mockGitRemotesSnapshot(): TestGitRemotesListResult {
				return {
					entries: mockGitRemoteEntries.map((entry) => ({
						...entry,
						fetchUrls: [...entry.fetchUrls],
						pushUrls: [...entry.pushUrls],
					})),
					truncated: seededGitRemotes.truncated,
				};
			}

			function mockGitLocalBranch(name: string): TestGitRefEntry | undefined {
				return mockGitRefEntries.find(
					(entry) => entry.kind === "branch" && entry.shortName === name,
				);
			}

			function mockGitTag(name: string): TestGitRefEntry | undefined {
				return mockGitRefEntries.find(
					(entry) => entry.kind === "tag" && entry.shortName === name,
				);
			}

			function mockGitRemote(name: string): TestGitRemoteEntry | undefined {
				return mockGitRemoteEntries.find((entry) => entry.name === name);
			}

			function mockGitManagementError(code: string, message: string) {
				return { code, message };
			}

			function ensureMockGitManagementAvailable(
				candidateRootId: unknown,
			): void {
				if (!terminalTrusted) {
					throw terminalNotTrusted();
				}
				if (candidateRootId !== rootId) {
					throw {
						code: "ROOT_NOT_AUTHORIZED",
						message:
							"The requested workspace root is not authorized for this window.",
					};
				}
				if (gitFixtureForTest.noRepositoryForTest === true) {
					throw gitNoRepository();
				}
			}

			function redactMockGitRemoteUrl(raw: string): string {
				if (raw.startsWith("file://")) {
					return "file://<local-path>";
				}
				if (
					raw.startsWith("/") ||
					raw.startsWith("./") ||
					raw.startsWith("../") ||
					raw.startsWith("\\\\") ||
					/^[A-Za-z]:[\\/]/.test(raw)
				) {
					return "<local-path>";
				}
				const suffix = raw.search(/[?#]/);
				const base = suffix < 0 ? raw : raw.slice(0, suffix);
				let display = base;
				const scheme = base.indexOf("://");
				if (scheme >= 0) {
					const authorityStart = scheme + 3;
					const slash = base.indexOf("/", authorityStart);
					const authorityEnd = slash < 0 ? base.length : slash;
					const authority = base.slice(authorityStart, authorityEnd);
					const at = authority.lastIndexOf("@");
					if (at >= 0) {
						display = `${base.slice(0, authorityStart)}<redacted>@${authority.slice(at + 1)}${base.slice(authorityEnd)}`;
					}
				} else {
					const at = base.indexOf("@");
					if (at >= 0 && base.slice(at + 1).includes(":")) {
						display = `<redacted>@${base.slice(at + 1)}`;
					}
				}
				return suffix < 0 ? display : `${display}?<redacted>`;
			}
			let mockGitStashEntries: TestGitStashEntry[] = (
				gitFixtureForTest.stashForTest ?? []
			).map((entry) => ({ ...entry }));
			const mockGitStashShow = new Map<string, TestGitShowCommitResult>(
				Object.entries(gitFixtureForTest.stashShowForTest ?? {}),
			);
			const mockGitStashConflicts = new Map<string, readonly string[]>(
				Object.entries(gitFixtureForTest.stashConflictForTest ?? {}),
			);
			let mockGitStashCounter = 0;
			function gitStashNotFound() {
				return {
					code: "GIT_STASH_NOT_FOUND",
					message: "No stash entry with the requested identity exists.",
				};
			}
			const defaultMockWorktreeEntry: TestGitWorktreeEntry = {
				path: "/workspace",
				headSha: "f".repeat(40),
				headState: { kind: "branch", refName: "refs/heads/main" },
				lockReason: null,
				prunableReason: null,
				isMain: true,
			};
			let mockGitWorktreeEntries: TestGitWorktreeEntry[] = (
				gitFixtureForTest.worktreesForTest ?? [defaultMockWorktreeEntry]
			).map((entry) => ({ ...entry }));
			const mockGitWorktreeDirtyPaths = new Set<string>(
				gitFixtureForTest.worktreeDirtyForTest ?? [],
			);
			let mockGitWorktreeCounter = 0;

			function gitNetworkNoUpstream() {
				return {
					code: "GIT_NETWORK_NO_UPSTREAM",
					message: "The current branch has no upstream configured.",
				};
			}
			function gitPushRejected() {
				return {
					code: "GIT_PUSH_REJECTED",
					message:
						"The remote rejected the push (it has commits this branch does not).",
				};
			}
			// `F220` S6: mirrors the real Rust `git::git_remote_network_unsupported()`
			// constructor exactly (same code, same message) — see that function's
			// own doc comment for why this is a distinct code from the generic
			// `ROOT_BACKEND_UNSUPPORTED` every other out-of-scope command still
			// falls back to.
			function gitRemoteNetworkUnsupported() {
				return {
					code: "GIT_REMOTE_NETWORK_UNSUPPORTED",
					message:
						"Network operations (fetch, pull, push) are not supported for a remote repository.",
				};
			}
			// `F220` S6: `git_network_preview`/`git_fetch`/`git_pull`/`git_push`'s
			// own remote-root fail-closed check — a root present in
			// `remoteRootTrees` (authorized via `remote_workspace_add_root`) is
			// remote-backed; every other authorized root is local. Mirrors
			// `browser-mock.ts`'s own `gitEffectiveNetworkRootIdForTest`/
			// `remoteRootBindings.has(...)` check for the same real behavior.
			function isMockGitRootRemote(rootId: unknown): boolean {
				return typeof rootId === "string" && remoteRootTrees.has(rootId);
			}
			function findMockGitEntryIndex(path: string): number {
				return mockGitEntries.findIndex(
					(entry) =>
						(entry.type === "ordinary" ||
							entry.type === "renameOrCopy" ||
							entry.type === "untracked") &&
						entry.path === path,
				);
			}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			function newMockOrdinaryEntry(
				indexStatus: string,
				worktreeStatus: string,
				path: string,
			): any {
				return {
					type: "ordinary",
					indexStatus,
					worktreeStatus,
					submodule: MOCK_ZERO_SUBMODULE,
					modeHead: "100644",
					modeIndex: "100644",
					modeWorktree: "100644",
					hashHead: MOCK_ZERO_HASH,
					hashIndex: MOCK_ZERO_HASH,
					path,
				};
			}
			function stageOneMockGitPath(path: string, wholeFile: boolean): void {
				const index = findMockGitEntryIndex(path);
				if (index === -1) {
					return;
				}
				const entry = mockGitEntries[index];
				if (entry.type === "untracked") {
					mockGitEntries[index] = newMockOrdinaryEntry(
						"A",
						wholeFile ? "." : "M",
						path,
					);
					return;
				}
				if (entry.worktreeStatus === ".") {
					return;
				}
				mockGitEntries[index] = {
					...entry,
					indexStatus: entry.worktreeStatus,
					worktreeStatus: wholeFile ? "." : entry.worktreeStatus,
				};
			}
			function unstageOneMockGitPath(path: string): void {
				const index = findMockGitEntryIndex(path);
				if (index === -1) {
					return;
				}
				const entry = mockGitEntries[index];
				if (entry.type !== "ordinary" && entry.type !== "renameOrCopy") {
					return;
				}
				if (entry.indexStatus === ".") {
					return;
				}
				if (entry.indexStatus === "A" && entry.worktreeStatus === ".") {
					mockGitEntries[index] = { type: "untracked", path };
					return;
				}
				mockGitEntries[index] = {
					...entry,
					worktreeStatus: entry.indexStatus,
					indexStatus: ".",
				};
			}
			function mockGitPathIsDiscardable(path: string): boolean {
				const index = findMockGitEntryIndex(path);
				if (index === -1) {
					return false;
				}
				const entry = mockGitEntries[index];
				return (
					(entry.type === "ordinary" || entry.type === "renameOrCopy") &&
					entry.worktreeStatus !== "."
				);
			}
			function discardOneMockGitPath(path: string): void {
				const index = findMockGitEntryIndex(path);
				if (index === -1) {
					return;
				}
				const entry = mockGitEntries[index];
				if (entry.type !== "ordinary" && entry.type !== "renameOrCopy") {
					return;
				}
				if (entry.indexStatus === ".") {
					mockGitEntries.splice(index, 1);
				} else {
					mockGitEntries[index] = { ...entry, worktreeStatus: "." };
				}
			}
			function mockGitHasStagedChanges(): boolean {
				return mockGitEntries.some(
					(entry) =>
						(entry.type === "ordinary" || entry.type === "renameOrCopy") &&
						entry.indexStatus !== ".",
				);
			}
			function commitMockGitStagedEntries(): void {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const nextEntries: any[] = [];
				for (const entry of mockGitEntries) {
					if (entry.type === "ordinary" || entry.type === "renameOrCopy") {
						if (entry.indexStatus === ".") {
							nextEntries.push(entry);
							continue;
						}
						if (entry.worktreeStatus === ".") {
							continue;
						}
						nextEntries.push({ ...entry, indexStatus: "." });
						continue;
					}
					nextEntries.push(entry);
				}
				mockGitEntries = nextEntries;
				mockGitCommitCounter += 1;
				mockGitBranch = {
					...mockGitBranch,
					oid: mockGitCommitCounter.toString(16).padStart(40, "0"),
				};
			}

			function terminalSessionNotFound() {
				return {
					code: "TERMINAL_SESSION_NOT_FOUND",
					message:
						"The requested terminal session does not exist for this window.",
				};
			}
			function getFakeTerminalSession(sessionId: unknown): FakeTerminalSession {
				const session =
					typeof sessionId === "string"
						? terminalSessions.get(sessionId)
						: undefined;
				if (session === undefined) {
					throw terminalSessionNotFound();
				}
				return session;
			}
			(
				window as unknown as Window & {
					// F070 "多 tab/split/scrollback": `sessionId` is optional so
					// every pre-existing single-terminal test (which never passes
					// it) keeps its original "push to whatever was last started"
					// behavior unchanged; multi-session tests pass an explicit id
					// (see `__PLAIN_TEST_TERMINAL_SESSION_IDS__` below) to target a
					// specific tab/pane's session.
					__PLAIN_TEST_TERMINAL_PUSH__(text: string, sessionId?: string): void;
					__PLAIN_TEST_TERMINAL_LAST_SESSION_ID__(): string | undefined;
					__PLAIN_TEST_TERMINAL_SESSION_IDS__(): readonly string[];
				}
			).__PLAIN_TEST_TERMINAL_PUSH__ = (text: string, sessionId?: string) => {
				const targetId = sessionId ?? lastStartedTerminalSessionId;
				if (targetId === undefined) {
					throw new Error("No terminal session has been started yet.");
				}
				const session = terminalSessions.get(targetId);
				if (session === undefined) {
					throw new Error(`Terminal session ${targetId} no longer exists.`);
				}
				terminalAppendText(session, text);
				requestTerminalEmit(session);
			};
			// `F190` S6 "真实 exit banner": simulates the shell process exiting
			// **on its own** (never via `terminal_kill`, which already emits its
			// own fixed exit event above and removes the session from this
			// fixture's table) — the session stays in `terminalSessions`
			// afterward, mirroring the real `TerminalService`'s own "an exited
			// session still occupies a slot until explicitly killed" contract
			// (`terminal::service`'s module doc), so a subsequent
			// `terminal_scrollback`/`terminal_kill` against the same id still
			// resolves normally.
			(
				window as unknown as Window & {
					__PLAIN_TEST_TERMINAL_EXIT__(
						exitCode: number,
						signal?: string | null,
						sessionId?: string,
					): void;
				}
			).__PLAIN_TEST_TERMINAL_EXIT__ = (exitCode, signal, sessionId) => {
				const targetId = sessionId ?? lastStartedTerminalSessionId;
				if (targetId === undefined) {
					throw new Error("No terminal session has been started yet.");
				}
				const session = terminalSessions.get(targetId);
				if (session === undefined) {
					throw new Error(`Terminal session ${targetId} no longer exists.`);
				}
				emitTerminalExit(session, exitCode, signal ?? null);
			};
			(
				window as unknown as Window & {
					__PLAIN_TEST_TERMINAL_LAST_SESSION_ID__(): string | undefined;
				}
			).__PLAIN_TEST_TERMINAL_LAST_SESSION_ID__ = () =>
				lastStartedTerminalSessionId;
			(
				window as unknown as Window & {
					__PLAIN_TEST_TERMINAL_SESSION_IDS__(): readonly string[];
				}
			).__PLAIN_TEST_TERMINAL_SESSION_IDS__ = () => [
				...terminalSessions.keys(),
			];
			// `F190` S4 "Ghostty metadata and links": scripts a session's OSC
			// 7 pwd / OSC 8 per-cell hyperlink / OSC 133 per-cell semantic /
			// OSC 133 per-row semantic-prompt metadata directly (this fixture
			// never derives any of the four from typed/pushed text — see
			// `FakeTerminalSession`'s own doc comment) and immediately
			// requests a frame emission, exactly like
			// `__PLAIN_TEST_TERMINAL_PUSH__` does for text.
			(
				window as unknown as Window & {
					__PLAIN_TEST_TERMINAL_SET_METADATA__(
						patch: {
							pwd?: string | null;
							hyperlink?: {
								row: number;
								colStart: number;
								colEnd: number;
								uri: string | null;
							};
							semantic?: {
								row: number;
								colStart: number;
								colEnd: number;
								kind: "output" | "input" | "prompt";
							};
							rowSemanticPrompt?: {
								row: number;
								kind: "none" | "prompt" | "continuation";
							};
						},
						sessionId?: string,
					): void;
				}
			).__PLAIN_TEST_TERMINAL_SET_METADATA__ = (patch, sessionId) => {
				const targetId = sessionId ?? lastStartedTerminalSessionId;
				if (targetId === undefined) {
					throw new Error("No terminal session has been started yet.");
				}
				const session = terminalSessions.get(targetId);
				if (session === undefined) {
					throw new Error(`Terminal session ${targetId} no longer exists.`);
				}
				if (patch.pwd !== undefined) {
					session.pwd = patch.pwd;
				}
				if (patch.hyperlink !== undefined) {
					const { row, colStart, colEnd, uri } = patch.hyperlink;
					for (let col = colStart; col < colEnd; col += 1) {
						const key = `${row}:${col}`;
						if (uri === null) {
							session.hyperlinks.delete(key);
						} else {
							session.hyperlinks.set(key, uri);
						}
					}
				}
				if (patch.semantic !== undefined) {
					const { row, colStart, colEnd, kind } = patch.semantic;
					for (let col = colStart; col < colEnd; col += 1) {
						session.semantics.set(`${row}:${col}`, kind);
					}
				}
				if (patch.rowSemanticPrompt !== undefined) {
					session.rowSemanticPrompts.set(
						patch.rowSemanticPrompt.row,
						patch.rowSemanticPrompt.kind,
					);
				}
				requestTerminalEmit(session);
			};
			(
				window as unknown as Window & {
					__PLAIN_TEST_CREATE_EXTERNAL_TERMINAL_SESSION__(
						sessionId: string,
						cols: number,
						rows: number,
					): void;
				}
			).__PLAIN_TEST_CREATE_EXTERNAL_TERMINAL_SESSION__ = (
				sessionId,
				cols,
				rows,
			) => {
				// `F100` S4: simulates a `runInTerminal`-launched session Rust's own
				// `TerminalService::start_program` already created — deliberately
				// bypasses `terminal_start` entirely (the whole point of this test
				// hook: the frontend must *attach* to an already-existing session,
				// never spawn a second one). Real production `plain/runInTerminal`
				// handling never calls `terminal_start` either — see
				// `app/platform/tauri/terminal-stream.ts`'s `attachTerminalStream`.
				terminalSessions.set(sessionId, {
					sessionId,
					cols,
					rows,
					lines: [],
					scrollback: [],
					cursorCol: 0,
					cursorRow: 0,
					nextSequence: 0,
					awaitingAck: false,
					pendingEmit: false,
					pwd: null,
					hyperlinks: new Map(),
					semantics: new Map(),
					rowSemanticPrompts: new Map(),
					exited: false,
				});
				// `F190` S6: mirrors real `TerminalService::start_program`, which
				// (like every other session-creation path) funnels through the
				// same shared `spawn_session` this domain's own
				// `record_started` call lives in — a `runInTerminal`-adopted
				// session counts toward this window's marker exactly like an
				// ordinary `terminal_start` one does.
				storeTerminalLifecycleMarker(loadTerminalLifecycleMarker() + 1);
			};

			testWindow.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
				unregisterListener() {},
			};
			testWindow.__TAURI_INTERNALS__ = {
				transformCallback(callback, once = false) {
					nextCallbackId += 1;
					if (callback !== undefined) {
						callbacks.set(nextCallbackId, { callback, once });
					}
					return nextCallbackId;
				},
				unregisterCallback(callbackId) {
					callbacks.delete(callbackId);
				},
				async invoke(command, args: Record<string, unknown> | Uint8Array = {}) {
					if (command === "workspace_publish_file") {
						if (!(args instanceof Uint8Array)) {
							throw new Error("Expected one raw PLN1 browser test frame.");
						}
						const frame = pln1Frame(args);
						calls.push({
							command,
							args: {
								rawHex: hexFromBytes(args),
								request: {
									rootId: frame.rootId,
									relativePath: frame.relativePath,
								},
								contentHex: hexFromBytes(frame.content),
							},
						});
						const target = resolveParent(
							frame.relativePath,
							treeForRootId(frame.rootId),
						);
						if (target.parent.entries.has(target.name)) {
							throw entryAlreadyExists();
						}
						const published = {
							kind: "file" as const,
							bytes: frame.content.slice(),
							version: nextVersion(),
						};
						target.parent.entries.set(target.name, published);
						return {
							status: "written",
							stat: {
								kind: "file",
								size: published.bytes.byteLength,
								mtime: 1_700_000_000_001,
								ctime: 1_699_999_000_000,
								version: published.version,
							},
						};
					}
					if (command === "workspace_write_file") {
						if (!(args instanceof Uint8Array)) {
							throw new Error("Expected one raw PLW1 browser test frame.");
						}
						const frame = plw1Frame(args);
						calls.push({
							command,
							args: {
								rawHex: hexFromBytes(args),
								request: {
									rootId: frame.rootId,
									relativePath: frame.relativePath,
									expectedVersion: frame.expectedVersion,
								},
								contentHex: hexFromBytes(frame.content),
							},
						});
						const node = resolveNode(
							frame.relativePath,
							treeForRootId(frame.rootId),
						);
						if (node.kind !== "file") {
							throw entryTypeMismatch();
						}
						if (node.version !== frame.expectedVersion) {
							throw {
								code: "WORKSPACE_FILE_MODIFIED",
								message: "The workspace file changed since it was read.",
							};
						}
						node.bytes = frame.content.slice();
						node.version = nextVersion();
						return {
							status: "written",
							stat: {
								kind: "file",
								size: node.bytes.byteLength,
								mtime: 1_700_000_000_001,
								ctime: 1_699_999_000_000,
								version: node.version,
							},
						};
					}
					if (command === "backup_write") {
						if (!(args instanceof Uint8Array)) {
							throw new Error("Expected one raw PLB2 browser test frame.");
						}
						const frame = plb2Frame(args);
						// `F220` S4: a real dirty edit against a
						// `remote_workspace_add_root`-authorized root reaches this
						// fixture's `backup_write` handler exactly like any other
						// authorized root would in production (Rust's own
						// `backup_write` validates against the currently authorized
						// root set without a backend restriction — see `F160` S0's
						// progress notes). Unlike the pre-`F220`-S4 shortcut this
						// replaces, a known remote root's backup is now genuinely
						// persisted (partitioned by `(rootId, key)` identity, exactly
						// like the fixed native root's own) and replayed by
						// `backup_read_all` — real hot-exit parity for remote roots,
						// not an accept-and-drop placeholder. Anything outside both
						// the fixed native root and every currently authorized remote
						// root still fails closed as a foreign root.
						if (frame.rootId !== rootId && !remoteRootTrees.has(frame.rootId)) {
							throw new Error("Backup targeted a foreign browser-test root.");
						}
						calls.push({
							command,
							args: {
								rootId: frame.rootId,
								key: frame.key,
								contentHex: hexFromBytes(frame.content),
							},
						});
						backupEntries.set(backupMapKey(frame.rootId, frame.key), {
							rootId: frame.rootId,
							key: frame.key,
							bytes: frame.content.slice(),
						});
						persistBackupEntries();
						return null;
					}
					if (command === "scratch_write") {
						if (!(args instanceof Uint8Array)) {
							throw new Error("Expected one raw PSW1 browser test frame.");
						}
						const frame = psw1Frame(args);
						calls.push({
							command,
							args: {
								scratchId: frame.scratchId,
								contentHex: hexFromBytes(frame.content),
							},
						});
						scratchEntries.set(frame.scratchId, frame.content.slice());
						persistScratchEntries();
						return null;
					}
					if (args instanceof Uint8Array) {
						throw new Error(`Unexpected raw Tauri test command: ${command}`);
					}
					calls.push({ command, args });
					const request = args.request as
						{ rootId?: string; relativePath?: string } | undefined;
					switch (command) {
						case "plugin:event|listen": {
							const event = args.event;
							const handlerId = args.handler;
							if (typeof event !== "string" || typeof handlerId !== "number") {
								throw new Error("Malformed Tauri event listener request.");
							}
							nextEventId += 1;
							eventHandlers.set(nextEventId, { event, handlerId });
							return nextEventId;
						}
						case "plugin:event|unlisten": {
							const eventId = args.eventId;
							if (typeof eventId === "number") {
								eventHandlers.delete(eventId);
							}
							return undefined;
						}
						case "runtime_info":
							return {
								application: "Plain",
								ipcVersion: 1,
								runtime: "tauri",
							};
						case "lifecycle_complete_close":
							return null;
						case "lifecycle_request_close":
							emitNativeCloseRequest("close");
							return null;
						case "user_data_read": {
							const resource = (args.request as { resource?: unknown })
								?.resource;
							const entry =
								resource === "settings" || resource === "keybindings"
									? userDataEntries.get(resource)
									: undefined;
							if (entry === undefined)
								throw new Error("Invalid user-data read.");
							return { resource, ...entry };
						}
						case "user_data_write": {
							const userRequest = args.request as {
								resource?: unknown;
								expectedRevision?: unknown;
								content?: unknown;
							};
							const resource = userRequest.resource;
							if (resource !== "settings" && resource !== "keybindings") {
								throw new Error("Invalid user-data write.");
							}
							const entry = userDataEntries.get(resource);
							if (
								entry === undefined ||
								entry.revision !== userRequest.expectedRevision ||
								typeof userRequest.content !== "string"
							) {
								throw new Error("Invalid user-data write.");
							}
							const next = {
								revision: entry.revision + 1,
								content: userRequest.content,
							};
							userDataEntries.set(resource, next);
							emitUserDataChanged(resource, next.revision);
							return { resource, ...next };
						}
						case "workspace_capabilities":
							return {
								create: true,
								renameNoReplace: true,
								copyMove: true,
								delete: mode === "supported",
								trash: mode === "supported",
								versionedWrite: true,
							};
						case "workspace_snapshot": {
							// `F220` S4 (ADR 0007 §4): cold-start restore-from-history
							// — consumed exactly once per fresh closure (a `page.reload()`
							// re-runs `addInitScript` from scratch, so this naturally
							// re-arms). Only ever restores the *local* half of the MRU
							// Recent entry; a purely remote one restores to zero local
							// roots and still reports `"restored"` (not `"failed"` — see
							// the `F220` S4 Rust patch's own identical `Restored`
							// outcome for this exact case), never auto-connecting the
							// remote half.
							if (initialRestoreStatus === "pending") {
								const lastEntry = recentState.entries.find(
									(entry) => entry.recentId === recentState.lastRecentId,
								);
								if (lastEntry === undefined) {
									initialRestoreStatus = "none";
								} else {
									if (lastEntry.hasLocalRoot) {
										currentSnapshot = selectedSnapshot;
									}
									initialRestoreStatus = "restored";
								}
							}
							return currentSnapshot;
						}
						case "workspace_pick_save_target": {
							const saveRequest = args.request as
								{ suggestedName?: unknown } | undefined;
							if (typeof saveRequest?.suggestedName !== "string") {
								throw new Error("Malformed Save As picker test request.");
							}
							const outcome = scriptedSavePicks.shift() ?? {
								status: "selected" as const,
							};
							if (outcome.status === "cancelled") {
								return {
									status: "cancelled",
									snapshot: currentSnapshot,
									target: null,
								};
							}
							const relativePath = outcome.name ?? saveRequest.suggestedName;
							let existingStat: Record<string, unknown> | null = null;
							try {
								const existing = resolveNode(relativePath);
								existingStat = {
									kind: existing.kind,
									size:
										existing.kind === "file" ? existing.bytes.byteLength : 0,
									mtime: 1_700_000_000_000,
									ctime: 1_699_999_000_000,
									version: existing.kind === "file" ? existing.version : null,
								};
							} catch (error) {
								if ((error as { code?: unknown })?.code !== "ENTRY_NOT_FOUND") {
									throw error;
								}
							}
							currentSnapshot = selectedSnapshot;
							return {
								status: "selected",
								snapshot: selectedSnapshot,
								target: {
									rootId,
									relativePath,
									existingStat,
								},
							};
						}
						case "workspace_recent_list":
							return {
								revision: recentState.revision,
								restoreStatus:
									initialRestoreStatus === "pending"
										? "none"
										: initialRestoreStatus,
								entries: recentState.entries.map((entry) => ({
									recentId: entry.recentId,
									label: entry.label,
									rootLabels: entry.hasLocalRoot ? ["native-workspace"] : [],
									remoteRoots: entry.remoteRoots,
								})),
							};
						case "workspace_open_recent": {
							const openRecentId = (
								args.request as { recentId?: unknown } | undefined
							)?.recentId;
							const entry = recentState.entries.find(
								(candidate) => candidate.recentId === openRecentId,
							);
							if (entry === undefined) {
								throw {
									code: "WORKSPACE_RECENT_NOT_FOUND",
									message:
										"The selected recent workspace is no longer available.",
								};
							}
							currentSnapshot = {
								workspaceId: currentSnapshot.workspaceId,
								revision: currentSnapshot.revision + 1,
								roots: entry.hasLocalRoot ? [...selectedSnapshot.roots] : [],
							};
							recordRecent();
							return currentSnapshot;
						}
						case "workspace_remove_recent": {
							const removeRecentId = (
								args.request as { recentId?: unknown } | undefined
							)?.recentId;
							const beforeCount = recentState.entries.length;
							recentState.entries = recentState.entries.filter(
								(candidate) => candidate.recentId !== removeRecentId,
							);
							if (recentState.entries.length === beforeCount) {
								throw {
									code: "WORKSPACE_RECENT_NOT_FOUND",
									message:
										"The selected recent workspace is no longer available.",
								};
							}
							if (recentState.lastRecentId === removeRecentId) {
								recentState.lastRecentId = null;
							}
							recentState.revision += 1;
							persistRecentState();
							return null;
						}
						case "workspace_clear_recent":
							recentState.entries = [];
							recentState.lastRecentId = null;
							recentState.revision += 1;
							persistRecentState();
							return null;
						case "workspace_pick_roots":
							currentSnapshot = selectedSnapshot;
							recordRecent();
							return { status: "selected", snapshot: selectedSnapshot };
						case "workspace_close_folder": {
							if (
								args.request === null ||
								typeof args.request !== "object" ||
								Object.keys(args.request).length !== 0
							) {
								throw new Error(
									"Malformed workspace_close_folder test request.",
								);
							}
							// `F220` S4: mirrors the real
							// `workspace::commands::workspace_close_folder`'s own
							// `record_current_workspace(...)` call whenever the close
							// actually changed anything (`changed` is Rust's own guard
							// for "there was something to close") — this is what makes
							// this window's next cold-start `workspace_snapshot` see an
							// empty `recentState.lastRecentId` (via `recordRecent()`'s
							// own "no current roots" branch) and correctly *not*
							// resurrect the just-closed workspace on the next
							// `page.reload()`, exactly like the real backend.
							const hadRootsToClose = currentSnapshot.roots.length > 0;
							currentSnapshot = closedSnapshot;
							if (hadRootsToClose) {
								recordRecent();
							}
							return closedSnapshot;
						}
						case "workspace_watch_sync": {
							const watchRequest = args.request as
								| {
										roots?: readonly {
											rootId?: string;
											acknowledgedGeneration?: number | null;
										}[];
								  }
								| undefined;
							const watchedRoot = watchRequest?.roots?.[0];
							if (
								watchRequest?.roots?.length !== 1 ||
								watchedRoot?.rootId !== rootId
							) {
								return { workspaceId, roots: [] };
							}
							if (watchedRoot.acknowledgedGeneration === null) {
								if (watchPending === undefined) {
									watchDirty = true;
									watchDirtyRescanRequired = true;
								}
							} else if (
								typeof watchedRoot.acknowledgedGeneration === "number" &&
								watchPending?.generation === watchedRoot.acknowledgedGeneration
							) {
								if (watchedRoot.acknowledgedGeneration === 0xffff_ffff) {
									watchPending.rescanRequired = true;
								} else {
									watchPending = undefined;
								}
							}
							promoteWatchDirty();
							return {
								workspaceId,
								roots: watchPending === undefined ? [] : [watchPending],
							};
						}
						case "workspace_create_file": {
							const relativePath = request?.relativePath ?? "";
							const { parent, name } = resolveParent(
								relativePath,
								treeForRootId(request?.rootId),
							);
							if (parent.entries.has(name)) {
								throw entryAlreadyExists();
							}
							parent.entries.set(name, file(""));
							return {
								kind: "file",
								size: 0,
								mtime: 0,
								ctime: 0,
								version: null,
							};
						}
						case "workspace_create_directory": {
							const relativePath = request?.relativePath ?? "";
							const { parent, name } = resolveParent(
								relativePath,
								treeForRootId(request?.rootId),
							);
							if (parent.entries.has(name)) {
								throw entryAlreadyExists();
							}
							parent.entries.set(name, directory([]));
							return {
								kind: "directory",
								size: 0,
								mtime: 0,
								ctime: 0,
								version: null,
							};
						}
						case "workspace_copy": {
							// The projected Browser workspace has one root, so this fixture
							// intentionally does not fabricate a cross-root workspace_move path.
							const copy = args.request as
								| {
										sourceRootId?: string;
										sourcePath?: string;
										targetRootId?: string;
										targetPath?: string;
								  }
								| undefined;
							if (
								copy === undefined ||
								Object.keys(copy).length !== 4 ||
								copy.sourceRootId !== rootId ||
								copy.targetRootId !== rootId ||
								typeof copy.sourcePath !== "string" ||
								typeof copy.targetPath !== "string"
							) {
								throw entryTypeMismatch();
							}
							const source = resolveNode(copy.sourcePath);
							if (source.kind !== "file") {
								throw entryTypeMismatch();
							}
							const target = resolveParent(copy.targetPath);
							if (target.parent.entries.has(target.name)) {
								throw entryAlreadyExists();
							}
							target.parent.entries.set(target.name, {
								kind: "file",
								bytes: source.bytes.slice(),
								version: nextVersion(),
							});
							return null;
						}
						case "workspace_rename": {
							const rename = args.request as
								| {
										rootId?: string;
										sourcePath?: string;
										targetPath?: string;
								  }
								| undefined;
							const renameTree = treeForRootId(rename?.rootId);
							const sourcePath = rename?.sourcePath ?? "";
							const targetPath = rename?.targetPath ?? "";
							const source = resolveParent(sourcePath, renameTree);
							const target = resolveParent(targetPath, renameTree);
							const node = source.parent.entries.get(source.name);
							if (node === undefined) {
								throw entryNotFound();
							}
							if (target.parent.entries.has(target.name)) {
								throw entryAlreadyExists();
							}
							source.parent.entries.delete(source.name);
							target.parent.entries.set(target.name, node);
							return null;
						}
						case "workspace_prepare_delete": {
							const prepare = args.request as
								| {
										entries?: readonly {
											rootId?: string;
											relativePath?: string;
											recursive?: boolean;
										}[];
								  }
								| undefined;
							const entry = prepare?.entries?.[0];
							if (
								activeDelete !== undefined ||
								activeTrash !== undefined ||
								prepare?.entries?.length !== 1 ||
								entry?.rootId === undefined ||
								(entry.rootId !== rootId &&
									!remoteRootTrees.has(entry.rootId)) ||
								typeof entry.relativePath !== "string" ||
								entry.recursive !== true
							) {
								throw invalidDeletePlan();
							}
							const node = resolveNode(
								entry.relativePath,
								treeForRootId(entry.rootId),
							);
							const confirmationId = nextDeleteId();
							const entryId = nextDeleteId();
							activeDelete = {
								confirmationId,
								entryId,
								rootId: entry.rootId,
								relativePath: entry.relativePath,
								recursive: true,
								phase: "prepared",
							};
							return {
								confirmationId,
								entries: [
									{
										entryId,
										kind: node.kind,
										descendantEntries: descendantEntries(node),
									},
								],
							};
						}
						case "workspace_cancel_delete": {
							const cancel = args.request as
								{ confirmationId?: string } | undefined;
							if (cancel?.confirmationId !== activeDelete?.confirmationId) {
								throw invalidDeletePlan();
							}
							activeDelete = undefined;
							return null;
						}
						case "workspace_begin_delete": {
							const begin = args.request as
								{ confirmationId?: string } | undefined;
							if (
								activeDelete === undefined ||
								begin?.confirmationId !== activeDelete.confirmationId ||
								activeDelete.phase !== "prepared"
							) {
								throw invalidDeletePlan();
							}
							activeDelete.phase = "executing";
							return null;
						}
						case "workspace_commit_delete_entry": {
							const commit = args.request as
								| {
										confirmationId?: string;
										entryId?: string;
										rootId?: string;
										relativePath?: string;
										recursive?: boolean;
								  }
								| undefined;
							if (
								activeDelete?.phase !== "executing" ||
								commit?.confirmationId !== activeDelete.confirmationId ||
								commit.entryId !== activeDelete.entryId ||
								commit.rootId !== activeDelete.rootId ||
								commit.relativePath !== activeDelete.relativePath ||
								commit.recursive !== activeDelete.recursive
							) {
								throw invalidDeletePlan();
							}
							deleteNode(
								activeDelete.relativePath,
								treeForRootId(activeDelete.rootId),
							);
							activeDelete = undefined;
							return { status: "deleted" };
						}
						case "workspace_prepare_trash": {
							const prepare = args.request as
								| {
										entries?: readonly {
											rootId?: string;
											relativePath?: string;
										}[];
								  }
								| undefined;
							const entry = prepare?.entries?.[0];
							if (
								activeDelete !== undefined ||
								activeTrash !== undefined ||
								prepare?.entries?.length !== 1 ||
								entry?.rootId !== rootId ||
								typeof entry.relativePath !== "string"
							) {
								throw invalidTrashPlan();
							}
							const node = resolveNode(entry.relativePath);
							const confirmationId = nextDeleteId();
							const entryId = nextDeleteId();
							activeTrash = {
								confirmationId,
								entryId,
								relativePath: entry.relativePath,
								phase: "prepared",
							};
							return {
								confirmationId,
								entries: [{ entryId, kind: node.kind }],
							};
						}
						case "workspace_cancel_trash": {
							const cancel = args.request as
								{ confirmationId?: string } | undefined;
							if (cancel?.confirmationId !== activeTrash?.confirmationId) {
								throw invalidTrashPlan();
							}
							activeTrash = undefined;
							return null;
						}
						case "workspace_begin_trash": {
							const begin = args.request as
								{ confirmationId?: string } | undefined;
							if (
								activeTrash === undefined ||
								begin?.confirmationId !== activeTrash.confirmationId ||
								activeTrash.phase !== "prepared"
							) {
								throw invalidTrashPlan();
							}
							if (scriptedTrashBeginFailures > 0) {
								scriptedTrashBeginFailures -= 1;
								activeTrash = undefined;
								throw {
									code: "WORKSPACE_TRASH_BATCH_CHANGED",
									message: "The workspace Trash batch changed.",
								};
							}
							activeTrash.phase = "executing";
							return null;
						}
						case "workspace_commit_trash_entry": {
							const commit = args.request as
								| {
										confirmationId?: string;
										entryId?: string;
										rootId?: string;
										relativePath?: string;
								  }
								| undefined;
							if (
								activeTrash?.phase !== "executing" ||
								commit?.confirmationId !== activeTrash.confirmationId ||
								commit.entryId !== activeTrash.entryId ||
								commit.rootId !== rootId ||
								commit.relativePath !== activeTrash.relativePath
							) {
								throw invalidTrashPlan();
							}
							const relativePath = activeTrash.relativePath;
							const outcome = scriptedTrashOutcomes.shift() ?? {
								status: "trashed" as const,
							};
							activeTrash = undefined;
							if (outcome.status === "trashed") {
								deleteNode(relativePath);
							}
							return outcome;
						}
						case "workspace_stat": {
							const relativePath = request?.relativePath ?? "";
							const node = resolveNode(
								relativePath,
								treeForRootId(request?.rootId),
							);
							return {
								kind: node.kind,
								size: node.kind === "file" ? node.bytes.byteLength : 0,
								mtime: 1_700_000_000_000,
								ctime: 1_699_999_000_000,
								version: node.kind === "file" ? node.version : null,
							};
						}
						case "workspace_read_dir": {
							const relativePath = request?.relativePath ?? "";
							const node = resolveNode(
								relativePath,
								treeForRootId(request?.rootId),
							);
							if (node.kind !== "directory") {
								throw entryTypeMismatch();
							}
							const entries = [...node.entries]
								.map(([name, child]) => ({ name, kind: child.kind }))
								.sort((left, right) =>
									left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
								);
							return { entries };
						}
						case "workspace_search_files": {
							const search = args.request as
								| {
										roots?: readonly string[];
										filePattern?: string;
										excludeGlobs?: readonly string[];
										maxResults?: number;
								  }
								| undefined;
							if (
								search === undefined ||
								!Array.isArray(search.roots) ||
								search.roots.length === 0 ||
								typeof search.filePattern !== "string" ||
								!Array.isArray(search.excludeGlobs) ||
								typeof search.maxResults !== "number"
							) {
								throw new Error(
									"Malformed workspace_search_files test request.",
								);
							}
							return searchFiles(
								search.roots,
								search.filePattern,
								search.excludeGlobs,
								search.maxResults,
							);
						}
						case "workspace_search_text_start": {
							const search = args.request as
								| {
										roots?: readonly string[];
										pattern?: string;
										isRegExp?: boolean;
										isCaseSensitive?: boolean;
										isWordMatch?: boolean;
										excludeGlobs?: readonly string[];
										maxResults?: number;
										maxFileSize?: number | null;
								  }
								| undefined;
							if (search === undefined || !Array.isArray(search.roots)) {
								throw new Error(
									"Malformed workspace_search_text_start test request.",
								);
							}
							const { pending, limitHit, skippedBinary, skippedOversize } =
								searchTextMatches(search);
							const searchId = crypto.randomUUID();
							activeTextSearch = {
								searchId,
								pending,
								deliveredCursor: 0,
								limitHit,
								skippedBinary,
								skippedOversize,
							};
							if (pending.length > 0) {
								emitTextSearchWake(searchId);
							}
							return { searchId };
						}
						case "workspace_search_text_poll": {
							if (textSearchPollDelayMsForTest > 0) {
								await new Promise((resolve) =>
									setTimeout(resolve, textSearchPollDelayMsForTest),
								);
							}
							const poll = args.request as
								{ searchId?: string; cursor?: number } | undefined;
							if (
								activeTextSearch === undefined ||
								poll?.searchId !== activeTextSearch.searchId
							) {
								throw searchNotFound();
							}
							if (poll.cursor !== activeTextSearch.deliveredCursor) {
								throw invalidSearchRequest();
							}
							// One batch per poll: exercises genuine multi-poll
							// streaming instead of delivering everything at once.
							const delivered = activeTextSearch.pending.splice(0, 1);
							activeTextSearch.deliveredCursor += delivered.length;
							const done = activeTextSearch.pending.length === 0;
							if (!done) {
								emitTextSearchWake(activeTextSearch.searchId);
							}
							return {
								batches: delivered,
								nextCursor: activeTextSearch.deliveredCursor,
								done,
								limitHit: activeTextSearch.limitHit,
								skipped: {
									binary: activeTextSearch.skippedBinary,
									oversize: activeTextSearch.skippedOversize,
								},
							};
						}
						case "workspace_search_text_cancel": {
							const cancel = args.request as { searchId?: string } | undefined;
							if (
								activeTextSearch === undefined ||
								cancel?.searchId !== activeTextSearch.searchId
							) {
								throw searchNotFound();
							}
							activeTextSearch = undefined;
							return null;
						}
						case "workspace_search_expand_replacements": {
							const search = args.request as
								| {
										pattern?: string;
										isRegExp?: boolean;
										isCaseSensitive?: boolean;
										isWordMatch?: boolean;
										replacementTemplate?: string;
										expectedTexts?: readonly string[];
								  }
								| undefined;
							if (search === undefined) {
								throw invalidSearchRequest();
							}
							return expandSearchReplacements(search);
						}
						case "workspace_read_file": {
							const relativePath = request?.relativePath ?? "";
							const node = resolveNode(
								relativePath,
								treeForRootId(request?.rootId),
							);
							if (node.kind !== "file") {
								throw entryTypeMismatch();
							}
							const frame = plr1Frame(
								node.bytes,
								1_700_000_000_000,
								1_699_999_000_000,
								node.version,
							);
							return rawReadTransport === "arrayBuffer"
								? frame.buffer
								: [...frame];
						}
						case "backup_read_all": {
							const frame = encodeBackupReadAllFrame();
							return rawReadTransport === "arrayBuffer"
								? frame.buffer
								: [...frame];
						}
						case "backup_discard": {
							const discard = args.request as
								{ rootId?: string; key?: string } | undefined;
							const key = discard?.key;
							if (
								typeof discard?.rootId !== "string" ||
								typeof key !== "string" ||
								(discard.rootId !== rootId &&
									!remoteRootTrees.has(discard.rootId))
							) {
								throw new Error("Malformed backup_discard test request.");
							}
							backupEntries.delete(backupMapKey(discard.rootId, key));
							persistBackupEntries();
							return null;
						}
						case "backup_discard_all": {
							// `F220` S4: mirrors `installMultiRootNativeIpcMock`'s own
							// identical "only ever discards a currently authorized
							// root's entries" filter.
							for (const [mapKey, entry] of backupEntries) {
								if (
									entry.rootId === rootId ||
									remoteRootTrees.has(entry.rootId)
								) {
									backupEntries.delete(mapKey);
								}
							}
							persistBackupEntries();
							return null;
						}
						case "scratch_create": {
							const scratchId = `00000000-0000-4000-8000-${(nextScratchOrdinal++)
								.toString(16)
								.padStart(12, "0")}`;
							return { scratchId };
						}
						case "scratch_read_all": {
							const frame = encodeScratchReadAllFrame();
							return rawReadTransport === "arrayBuffer"
								? frame.buffer
								: [...frame];
						}
						case "scratch_discard": {
							const scratchId = (
								args.request as { scratchId?: unknown } | undefined
							)?.scratchId;
							if (typeof scratchId !== "string") {
								throw new Error("Malformed scratch discard test request.");
							}
							scratchEntries.delete(scratchId);
							persistScratchEntries();
							return null;
						}
						case "scratch_discard_all":
							scratchEntries.clear();
							persistScratchEntries();
							return null;
						case "theme_import_vsix":
						case "theme_import_directory":
							return themeImportFromScript();
						case "theme_list": {
							const packages = [...themePackages.values()].sort(
								(left, right) =>
									left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
							);
							return { packages, skipped: 0 };
						}
						case "theme_read_resource": {
							const themeRequest = args.request as
								{ packageId?: string; relativePath?: string } | undefined;
							const summary =
								themeRequest?.packageId === undefined
									? undefined
									: themePackages.get(themeRequest.packageId);
							const resources =
								themeRequest?.packageId === undefined
									? undefined
									: themeResourceContents.get(themeRequest.packageId);
							const content =
								themeRequest?.relativePath === undefined
									? undefined
									: resources?.get(themeRequest.relativePath);
							if (
								summary === undefined ||
								themeRequest?.relativePath === undefined ||
								!summary.resources.includes(themeRequest.relativePath) ||
								content === undefined
							) {
								throw themeResourceNotFound();
							}
							const themeBytes = encoder.encode(content);
							return rawReadTransport === "arrayBuffer"
								? themeBytes.buffer
								: [...themeBytes];
						}
						case "theme_remove": {
							const themeRequest = args.request as
								{ packageId?: string } | undefined;
							if (themeRequest?.packageId !== undefined) {
								themePackages.delete(themeRequest.packageId);
								themeResourceContents.delete(themeRequest.packageId);
							}
							return null;
						}
						case "theme_get_selection":
							return {
								themeId: themeSelection,
								fileIconThemeId: fileIconThemeSelection,
								productIconThemeId: productIconThemeSelection,
							};
						case "theme_set_selection": {
							// `F060` S3: mirrors Rust's own per-field update
							// semantics — a field this exact request object does
							// not carry at all leaves that axis untouched (only
							// an explicitly-present key, `null` or a string,
							// updates it). See `theme::selection`'s module doc
							// comment for the full rationale.
							const themeRequest = (args.request ?? {}) as Record<
								string,
								string | null | undefined
							>;
							if ("themeId" in themeRequest) {
								themeSelection = themeRequest.themeId ?? null;
							}
							if ("fileIconThemeId" in themeRequest) {
								fileIconThemeSelection = themeRequest.fileIconThemeId ?? null;
							}
							if ("productIconThemeId" in themeRequest) {
								productIconThemeSelection =
									themeRequest.productIconThemeId ?? null;
							}
							return null;
						}
						case "workspace_trust_state":
							return { trusted: terminalTrusted };
						case "workspace_trust_grant":
							terminalTrusted = true;
							return { trusted: true };
						case "workspace_trust_revoke":
							terminalTrusted = false;
							return null;
						case "debug_adapter_confirmation_state": {
							const confirmRequest = args.request as
								| {
										command?: string;
										args?: readonly string[];
										transport?: string;
								  }
								| undefined;
							const confirmRootId = args.rootId as string | undefined;
							return {
								confirmed: debugAdapterConfirmations.has(
									debugAdapterConfirmationKey(
										confirmRequest ?? {},
										confirmRootId,
									),
								),
							};
						}
						case "debug_adapter_confirmation_grant": {
							const confirmRequest = args.request as
								| {
										command?: string;
										args?: readonly string[];
										transport?: string;
								  }
								| undefined;
							const confirmRootId = args.rootId as string | undefined;
							debugAdapterConfirmations.add(
								debugAdapterConfirmationKey(
									confirmRequest ?? {},
									confirmRootId,
								),
							);
							return null;
						}
						case "debug_adapter_confirmation_revoke": {
							const confirmRequest = args.request as
								| {
										command?: string;
										args?: readonly string[];
										transport?: string;
								  }
								| undefined;
							const confirmRootId = args.rootId as string | undefined;
							debugAdapterConfirmations.delete(
								debugAdapterConfirmationKey(
									confirmRequest ?? {},
									confirmRootId,
								),
							);
							return null;
						}
						case "debug_launch":
						case "debug_attach": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							const startRequest = args.request as
								| {
										rootId?: string;
										command?: string;
										args?: readonly string[];
										transport?: string;
										port?: number;
								  }
								| undefined;
							// `F220` S7 — a remote-backed root is a real, separately
							// authorized root, not only the fixed native one: any id
							// `remoteRootBindings` recognizes is accepted too — see
							// that map's own doc comment.
							const launchTargetRootId = startRequest?.rootId;
							const launchTargetIsRemote =
								launchTargetRootId !== undefined &&
								remoteRootBindings.has(launchTargetRootId);
							if (launchTargetRootId !== rootId && !launchTargetIsRemote) {
								throw debugRootNotAuthorized();
							}
							// `F220` S7 — research doc "架构裁定 §4"/v1 narrowing:
							// only the `stdio` (exec-channel) transport is
							// supported for a remote root — `tcp`/`tcpSpawn` fail
							// closed here, before any confirmation check, exactly
							// like `debug::service::DebugSessionService::start_session_with_tcp_spawn_budget`'s
							// own `workspace.remote_context` dispatch.
							if (
								launchTargetIsRemote &&
								(startRequest?.transport === "tcp" ||
									startRequest?.transport === "tcpSpawn")
							) {
								throw debugRemoteTransportUnsupported();
							}
							// `F210` S6 — a `"tcpSpawn"` request is confirmed
							// under the same `"tcp"` identity a plain `"tcp"`
							// request uses (see `plain-debug-adapter-launch.ts`'s
							// own mapping) — never a third, distinct
							// confirmation identity.
							const isTcpSpawn = startRequest?.transport === "tcpSpawn";
							if (
								!debugAdapterConfirmations.has(
									debugAdapterConfirmationKey(
										{
											...startRequest,
											transport: isTcpSpawn ? "tcp" : startRequest?.transport,
										},
										launchTargetRootId,
									),
								)
							) {
								throw debugAdapterNotConfirmed();
							}
							if (isTcpSpawn) {
								const outcome =
									debugFixtureForTest.tcpSpawnOutcomeForTest ?? "success";
								if (outcome === "processExitedBeforeListening") {
									throw debugAdapterTcpCompanionExited();
								}
								if (outcome === "connectTimedOut") {
									throw debugAdapterTcpCompanionConnectTimedOut();
								}
							}
							const sessionId = nextDebugSessionId();
							liveDebugSessions.add(sessionId);
							debugSessionRoots.set(sessionId, launchTargetRootId ?? rootId);
							return {
								sessionId,
								capabilities: debugFixtureForTest.capabilities ?? {},
							};
						}
						case "debug_disconnect": {
							const disconnectRequest = args.request as
								{ sessionId?: string } | undefined;
							const disconnectSessionId = disconnectRequest?.sessionId ?? "";
							if (!liveDebugSessions.delete(disconnectSessionId)) {
								throw debugSessionNotFound();
							}
							debugSessionRoots.delete(disconnectSessionId);
							return null;
						}
						case "debug_set_breakpoints": {
							const setBreakpointsRequest = args.request as
								| {
										sessionId?: string;
										rootId?: string;
										path?: string;
										breakpoints?: readonly { line: number }[];
								  }
								| undefined;
							const breakpointSessionId =
								setBreakpointsRequest?.sessionId ?? "";
							if (
								!liveDebugSessions.has(breakpointSessionId) ||
								// `F220` S7 — no longer forced to the fixed native
								// `rootId`: whichever root `debug_launch`/`debug_attach`
								// actually recorded for this session (native or
								// remote — see `debugSessionRoots.set`'s own call
								// site) is the only one this session's own
								// `debug_set_breakpoints` calls may ever name.
								setBreakpointsRequest?.rootId !==
									debugSessionRoots.get(breakpointSessionId)
							) {
								throw debugSessionNotFound();
							}
							const outcomesForPath =
								debugFixtureForTest.breakpointOutcomes?.[
									setBreakpointsRequest?.path ?? ""
								];
							const reported = (setBreakpointsRequest?.breakpoints ?? []).map(
								(entry) => {
									const outcome = outcomesForPath?.[entry.line];
									if (outcome?.verified === false) {
										return {
											verified: false,
											line: null,
											id: null,
											message:
												outcome.message ?? "Breakpoint could not be set.",
										};
									}
									return {
										verified: true,
										line: outcome?.line ?? entry.line,
										id: null,
										message: null,
									};
								},
							);
							return { breakpoints: reported };
						}
						case "debug_stack_trace": {
							const stackTraceRequest = args.request as
								| {
										sessionId?: string;
										threadId?: number;
										startFrame?: number | null;
										levels?: number | null;
								  }
								| undefined;
							if (!liveDebugSessions.has(stackTraceRequest?.sessionId ?? "")) {
								throw debugSessionNotFound();
							}
							const allFrames =
								debugFixtureForTest.stackFramesByThread?.[
									stackTraceRequest?.threadId ?? -1
								] ?? [];
							const startFrame = stackTraceRequest?.startFrame ?? 0;
							const levels = stackTraceRequest?.levels ?? null;
							const slicedFrames =
								levels === null
									? allFrames.slice(startFrame)
									: allFrames.slice(startFrame, startFrame + levels);
							return {
								stackFrames: slicedFrames,
								totalFrames: allFrames.length,
							};
						}
						case "debug_scopes": {
							const scopesRequest = args.request as
								{ sessionId?: string; frameId?: number } | undefined;
							if (!liveDebugSessions.has(scopesRequest?.sessionId ?? "")) {
								throw debugSessionNotFound();
							}
							return {
								scopes:
									debugFixtureForTest.scopesByFrame?.[
										scopesRequest?.frameId ?? -1
									] ?? [],
							};
						}
						case "debug_variables": {
							const variablesRequest = args.request as
								| {
										sessionId?: string;
										variablesReference?: number;
										start?: number | null;
										count?: number | null;
								  }
								| undefined;
							if (!liveDebugSessions.has(variablesRequest?.sessionId ?? "")) {
								throw debugSessionNotFound();
							}
							const allVariables =
								debugFixtureForTest.variablesByReference?.[
									variablesRequest?.variablesReference ?? -1
								] ?? [];
							const startIndex = variablesRequest?.start ?? 0;
							const count = variablesRequest?.count ?? null;
							const slicedVariables =
								count === null
									? allVariables.slice(startIndex)
									: allVariables.slice(startIndex, startIndex + count);
							return { variables: slicedVariables };
						}
						case "debug_evaluate": {
							const evaluateRequest = args.request as
								{ sessionId?: string; expression?: string } | undefined;
							if (!liveDebugSessions.has(evaluateRequest?.sessionId ?? "")) {
								throw debugSessionNotFound();
							}
							const expression = evaluateRequest?.expression ?? "";
							const scripted =
								debugFixtureForTest.evaluateByExpression?.[expression];
							if (scripted !== undefined) {
								return scripted;
							}
							return {
								result: expression,
								type: null,
								variablesReference: 0,
								namedVariables: null,
								indexedVariables: null,
							};
						}
						case "debug_continue": {
							const continueRequest = args.request as
								{ sessionId?: string; threadId?: number } | undefined;
							if (!liveDebugSessions.has(continueRequest?.sessionId ?? "")) {
								throw debugSessionNotFound();
							}
							if (debugFixtureForTest.stepRequestsRejectedForTest === true) {
								throw debugRequestFailedNotStopped("continue");
							}
							return { allThreadsContinued: true };
						}
						case "debug_step_in_targets": {
							const stepInTargetsRequest = args.request as
								{ sessionId?: string; frameId?: number } | undefined;
							if (
								!liveDebugSessions.has(stepInTargetsRequest?.sessionId ?? "")
							) {
								throw debugSessionNotFound();
							}
							const targets =
								debugFixtureForTest.stepInTargetsByFrame?.[
									stepInTargetsRequest?.frameId ?? -1
								] ?? [];
							return { targets, truncated: false };
						}
						case "debug_disassemble": {
							const disassembleRequest = args.request as
								| {
										sessionId?: string;
										memoryReference?: string;
										instructionOffset?: number;
										instructionCount?: number;
								  }
								| undefined;
							if (!liveDebugSessions.has(disassembleRequest?.sessionId ?? "")) {
								throw debugSessionNotFound();
							}
							if ((debugFixtureForTest.disassembleDelayMsForTest ?? 0) > 0) {
								await new Promise((resolve) =>
									setTimeout(
										resolve,
										debugFixtureForTest.disassembleDelayMsForTest,
									),
								);
							}
							const instructions =
								debugFixtureForTest.disassemblyByMemoryReference?.[
									disassembleRequest?.memoryReference ?? ""
								]?.[disassembleRequest?.instructionOffset ?? Number.NaN] ?? [];
							return { instructions };
						}
						case "debug_next":
						case "debug_step_in":
						case "debug_step_out":
						case "debug_pause": {
							const stepRequest = args.request as
								{ sessionId?: string; threadId?: number } | undefined;
							if (!liveDebugSessions.has(stepRequest?.sessionId ?? "")) {
								throw debugSessionNotFound();
							}
							if (debugFixtureForTest.stepRequestsRejectedForTest === true) {
								const dapCommandName = {
									debug_next: "next",
									debug_step_in: "stepIn",
									debug_step_out: "stepOut",
									debug_pause: "pause",
								}[
									command as
										| "debug_next"
										| "debug_step_in"
										| "debug_step_out"
										| "debug_pause"
								];
								throw debugRequestFailedNotStopped(dapCommandName);
							}
							return null;
						}
						case "debug_output_ack": {
							// `F100` S5 — this mock does not itself reimplement
							// `output_gate.rs`'s real merge/elide backlog (the
							// Playwright tests below drive the gate's
							// *frontend-visible effects* directly via
							// `__PLAIN_TEST_EMIT_DEBUG_EVENT__`, and assert this
							// real command actually fires with the right
							// `sequence` via `terminalCallsFor`); acking a live
							// session is otherwise a harmless no-op here,
							// mirroring `terminal_ack`'s own tolerant shape.
							return null;
						}
						case "remote_session_connect": {
							const connectRequest = args.request as
								{ host?: string; port?: number; user?: string } | undefined;
							const host = connectRequest?.host ?? "";
							const port = connectRequest?.port ?? 0;
							const user = connectRequest?.user ?? "";
							const key = remoteMockTargetKey(host, port);
							const pinned = remoteKnownHosts.get(key);
							if (pinned === undefined) {
								return {
									status: "hostKeyPendingConfirmation",
									algorithm: "ssh-ed25519",
									sha256Fingerprint: remoteMockFingerprint(host, port, false),
									knownHostsHit: false,
								};
							}
							const changed = changedHostKeyTargetsRuntime.has(key);
							const liveFingerprint = remoteMockFingerprint(
								host,
								port,
								changed,
							);
							if (liveFingerprint !== pinned.sha256Fingerprint) {
								throw remoteHostKeyChanged(
									host,
									port,
									pinned.algorithm,
									pinned.sha256Fingerprint,
									liveFingerprint,
								);
							}
							return remoteCompleteConnect(host, port, user);
						}
						case "remote_host_key_confirm": {
							const confirmRequest = args.request as
								| {
										host?: string;
										port?: number;
										user?: string;
										algorithm?: string;
										sha256Fingerprint?: string;
								  }
								| undefined;
							const host = confirmRequest?.host ?? "";
							const port = confirmRequest?.port ?? 0;
							const user = confirmRequest?.user ?? "";
							const algorithm = confirmRequest?.algorithm ?? "";
							const sha256Fingerprint = confirmRequest?.sha256Fingerprint ?? "";
							const key = remoteMockTargetKey(host, port);
							remoteKnownHosts.set(key, { algorithm, sha256Fingerprint });
							const changed = changedHostKeyTargetsRuntime.has(key);
							const liveFingerprint = remoteMockFingerprint(
								host,
								port,
								changed,
							);
							if (liveFingerprint !== sha256Fingerprint) {
								throw remoteHostKeyChanged(
									host,
									port,
									algorithm,
									sha256Fingerprint,
									liveFingerprint,
								);
							}
							return remoteCompleteConnect(host, port, user);
						}
						case "remote_session_connect_cancel": {
							// Best-effort in production; this mock never has a
							// genuinely in-flight connect to cancel (every case
							// above resolves synchronously), so there is nothing to
							// do — mirrors `browser-mock.ts`'s identical no-op.
							return null;
						}
						case "remote_session_disconnect": {
							const disconnectRequest = args.request as
								{ sessionId?: string } | undefined;
							const sessionId = disconnectRequest?.sessionId ?? "";
							const session = remoteSessions.get(sessionId);
							if (session === undefined) {
								throw remoteSessionNotFound();
							}
							remoteSessions.delete(sessionId);
							emitRemoteSessionEvent({
								event: "disconnected",
								sessionId,
								host: session.host,
								port: session.port,
								user: session.user,
								reason: "userRequested",
							});
							return null;
						}
						case "remote_session_state": {
							const sessions = [...remoteSessions.entries()]
								.map(([sessionId, session]) => ({
									sessionId,
									host: session.host,
									port: session.port,
									user: session.user,
								}))
								.sort((left, right) =>
									left.host === right.host
										? left.port - right.port
										: left.host.localeCompare(right.host),
								);
							return { sessions };
						}
						case "remote_host_key_forget": {
							const forgetRequest = args.request as
								{ host?: string; port?: number } | undefined;
							remoteKnownHosts.delete(
								remoteMockTargetKey(
									forgetRequest?.host ?? "",
									forgetRequest?.port ?? 0,
								),
							);
							return null;
						}
						case "remote_host_key_list": {
							const entries = [...remoteKnownHosts.entries()]
								.map(([key, entry]) => {
									const separatorIndex = key.lastIndexOf(":");
									return {
										host: key.slice(0, separatorIndex),
										port: Number(key.slice(separatorIndex + 1)),
										algorithm: entry.algorithm,
										sha256Fingerprint: entry.sha256Fingerprint,
									};
								})
								.sort((left, right) =>
									left.host === right.host
										? left.port - right.port
										: left.host.localeCompare(right.host),
								);
							return { entries };
						}
						case "remote_workspace_pick_directory": {
							const pickRequest = args.request as
								| {
										sessionId?: string;
										path?: string;
										offset?: number;
										limit?: number;
								  }
								| undefined;
							if (
								pickRequest === undefined ||
								!remoteSessions.has(pickRequest.sessionId ?? "") ||
								typeof pickRequest.path !== "string" ||
								typeof pickRequest.offset !== "number" ||
								typeof pickRequest.limit !== "number"
							) {
								throw pickRequest !== undefined &&
									!remoteSessions.has(pickRequest.sessionId ?? "")
									? remoteSessionNotFound()
									: remoteRequestInvalid();
							}
							const canonicalPath = remoteNormalizePath(pickRequest.path);
							const directoryNode = remoteWorkspaceDirectoryAt(canonicalPath);
							const allNames = [...directoryNode.entries.entries()]
								.filter(([, child]) => child.kind === "directory")
								.map(([name]) => name)
								.sort((left, right) => left.localeCompare(right));
							const page = allNames.slice(
								pickRequest.offset,
								pickRequest.offset + pickRequest.limit,
							);
							const parentSegments = canonicalPath
								.split("/")
								.filter((s) => s.length > 0);
							parentSegments.pop();
							const parentPath =
								canonicalPath === "/"
									? null
									: parentSegments.length === 0
										? "/"
										: `/${parentSegments.join("/")}`;
							return {
								canonicalPath,
								parentPath,
								entries: page,
								total: allNames.length,
								offset: pickRequest.offset,
								hasMore: pickRequest.offset + page.length < allNames.length,
							};
						}
						case "remote_workspace_add_root": {
							const addRootRequest = args.request as
								| { sessionId?: string; path?: string; displayName?: string }
								| undefined;
							if (
								addRootRequest === undefined ||
								!remoteSessions.has(addRootRequest.sessionId ?? "") ||
								typeof addRootRequest.path !== "string"
							) {
								throw addRootRequest !== undefined &&
									!remoteSessions.has(addRootRequest.sessionId ?? "")
									? remoteSessionNotFound()
									: remoteRequestInvalid();
							}
							const canonicalPath = remoteNormalizePath(addRootRequest.path);
							const authorizedNode = remoteWorkspaceDirectoryAt(canonicalPath);
							if (authorizedNode.kind !== "directory") {
								throw remoteNotADirectory();
							}
							const newRootId = nextRemoteRootId();
							remoteRootTrees.set(newRootId, authorizedNode);
							// `F220` S4: this root's fixed identity — untouched by any
							// later `remote_workspace_reconnect_root` call, which only
							// ever moves `sessionId`. See `remoteRootBindings`'s own
							// doc comment.
							const addRootSession = remoteSessions.get(
								addRootRequest.sessionId!,
							)!;
							remoteRootBindings.set(newRootId, {
								sessionId: addRootRequest.sessionId!,
								hostKeyFingerprint: addRootSession.hostKeyFingerprint,
								basePath: canonicalPath,
							});
							currentSnapshot = {
								workspaceId: currentSnapshot.workspaceId,
								revision: currentSnapshot.revision + 1,
								roots: [
									...currentSnapshot.roots,
									{
										rootId: newRootId,
										displayName:
											addRootRequest.displayName ??
											remoteDisplayNameFor(canonicalPath),
										uri: `plain-workspace://${newRootId}/`,
									},
								],
							};
							// `F220` S4: mirrors `remote_workspace_add_root`'s own real
							// Rust addition — records into Recent exactly like
							// `workspace_pick_roots` already does, so a window whose
							// only root-set-changing action was adding a remote root
							// still produces a Recent entry.
							recordRecent();
							return currentSnapshot;
						}
						// `F220` S4 (ADR 0006 §5's own "显式重连是新的信任决策"):
						// rebinds an already-authorized remote root onto a brand-new
						// SSH session — mirrors the real Rust
						// `remote_workspace_reconnect_root`'s own exact check order:
						// root existence → live new session → host-key identity match
						// → re-resolved base path match. Deliberately does not bump
						// `currentSnapshot.revision` (only `sessionId` moves — see
						// `remoteRootBindings`'s own doc comment), so a caller polling
						// `workspace_snapshot`'s `revision` alone cannot observe a
						// reconnect at all, exactly like the real backend.
						case "remote_workspace_reconnect_root": {
							const reconnectRequest = args.request as
								{ rootId?: string; sessionId?: string } | undefined;
							const targetRootId = reconnectRequest?.rootId;
							const newSessionId = reconnectRequest?.sessionId;
							if (
								typeof targetRootId !== "string" ||
								typeof newSessionId !== "string"
							) {
								throw remoteRequestInvalid();
							}
							const binding = remoteRootBindings.get(targetRootId);
							if (binding === undefined) {
								if (targetRootId === rootId) {
									// A `Local` root has no session to rebind — mirrors the
									// real `ROOT_BACKEND_UNSUPPORTED`.
									throw {
										code: "ROOT_BACKEND_UNSUPPORTED",
										message:
											"This workspace root's backend does not support the requested operation.",
									};
								}
								throw {
									code: "ROOT_NOT_AUTHORIZED",
									message:
										"The requested workspace root is not authorized for this window.",
								};
							}
							const newSession = remoteSessions.get(newSessionId);
							if (newSession === undefined) {
								throw remoteSessionNotFound();
							}
							if (
								newSession.hostKeyFingerprint !== binding.hostKeyFingerprint
							) {
								throw {
									code: "REMOTE_ROOT_IDENTITY_CHANGED",
									message:
										"The reconnected SSH session's host identity does not match this workspace root's original identity.",
								};
							}
							// Re-`realpath`s the root's original base path over the new
							// session — this mock's browse tree has no per-session
							// state, so re-resolving the exact same literal path either
							// still exists (unchanged — the common case) or no longer
							// exists (`remoteWorkspaceDirectoryAt` throws
							// `ENTRY_NOT_FOUND`, propagated verbatim exactly like the
							// real `canonicalize_for_root`'s own unmodified error).
							remoteWorkspaceDirectoryAt(binding.basePath);
							binding.sessionId = newSessionId;
							return currentSnapshot;
						}
						case "terminal_profiles": {
							return {
								profiles: [
									{
										id: "systemDefault",
										label: "zsh (System Default)",
									},
									{ id: "zsh", label: "zsh" },
									{ id: "sh", label: "sh" },
								],
								defaultProfileId: "systemDefault",
							};
						}
						case "terminal_start": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							const startRequest = args.request as
								| {
										rootId?: string;
										profileId?: string;
										cwd?: string | null;
										cols?: number;
										rows?: number;
								  }
								| undefined;
							const isNativeRoot =
								startRequest?.rootId === rootId &&
								currentSnapshot.roots.some(
									(candidate) => candidate.rootId === rootId,
								);
							// `F220` S5: a remote-bound root is also a legitimate
							// `terminal_start` target — mirrors
							// `TerminalService::start`'s own `workspace.remote_context(...)`
							// dispatch, which routes to `start_remote` *before* any of the
							// local-only checks below.
							const remoteBinding =
								startRequest?.rootId === undefined
									? undefined
									: remoteRootBindings.get(startRequest.rootId);
							const isRemoteRoot =
								remoteBinding !== undefined &&
								currentSnapshot.roots.some(
									(candidate) => candidate.rootId === startRequest?.rootId,
								);
							if (!isNativeRoot && !isRemoteRoot) {
								throw new Error(
									"terminal_start must target the one authorized native root or an authorized remote root",
								);
							}
							if (isRemoteRoot) {
								// Mirrors `treeForRootId`'s own identical "disconnected
								// binding fails closed" check for FS operations.
								if (!remoteSessions.has(remoteBinding.sessionId)) {
									throw remoteSessionDisconnected();
								}
								// `F220` S5 v1 narrowing
								// (`terminal::service::TerminalService::start_remote`): no
								// remote profile enumeration, and no cwd override — a remote
								// terminal always starts at the remote user's own home
								// directory.
								if (startRequest?.profileId !== "systemDefault") {
									throw terminalProfileInvalid();
								}
								if (
									startRequest?.cwd !== undefined &&
									startRequest.cwd !== null
								) {
									throw terminalCwdInvalid();
								}
							} else {
								// `F190` S2: this fixture's `terminal_profiles` snapshot (see
								// that case below) only ever issues
								// `systemDefault`/`zsh`/`sh` — the same bounded set a real
								// `terminal_start` would accept. `cwd` mirrors Rust's own
								// `resolve_cwd`: `null`, or a relative path that does not try
								// to leave the root.
								if (
									startRequest?.profileId !== "systemDefault" &&
									startRequest?.profileId !== "zsh" &&
									startRequest?.profileId !== "sh"
								) {
									throw terminalProfileInvalid();
								}
								if (
									typeof startRequest?.cwd === "string" &&
									(startRequest.cwd.startsWith("/") ||
										startRequest.cwd.split("/").includes(".."))
								) {
									throw terminalCwdInvalid();
								}
							}
							const sessionId = nextTerminalSessionId();
							const session: FakeTerminalSession = {
								sessionId,
								cols: startRequest?.cols ?? 80,
								rows: startRequest?.rows ?? 24,
								lines: [],
								scrollback: [],
								cursorCol: 0,
								cursorRow: 0,
								nextSequence: 0,
								awaitingAck: false,
								pendingEmit: false,
								pwd: null,
								hyperlinks: new Map(),
								semantics: new Map(),
								rowSemanticPrompts: new Map(),
								exited: false,
							};
							terminalSessions.set(sessionId, session);
							lastStartedTerminalSessionId = sessionId;
							// `F190` S6 "跨进程不伪造 session restore": mirrors
							// `TerminalService::spawn_session`'s own
							// `TerminalLifecycleMarkerStore::record_started` call — every
							// successful session start increments this window's marker,
							// regardless of whether it is later explicitly closed
							// (`terminal_kill`, below) or left un-closed for a later
							// `terminal_lifecycle_marker` call to report.
							storeTerminalLifecycleMarker(loadTerminalLifecycleMarker() + 1);
							// `F190` S4: mirrors `terminal::shell_integration::plan_for_shell`'s
							// own family split — `systemDefault`/`zsh` are audited families
							// (`injected`); `sh` is deliberately not, exactly like the real
							// `SHELL_PROFILE_SPECS` entry of the same name, so a test can
							// exercise the accurate `unsupportedShell` degrade status without
							// this fixture needing to model every real shell family. `F220`
							// S5: a remote root is always `unsupportedShell` — v1 never
							// uploads the injection files to a remote host at all (see
							// `TerminalService::start_remote`'s own doc comment).
							return {
								sessionId,
								shellIntegration:
									isRemoteRoot || startRequest?.profileId === "sh"
										? "unsupportedShell"
										: "injected",
							};
						}
						case "terminal_input_text": {
							const inputRequest = args.request as
								{ sessionId?: string; text?: string } | undefined;
							const session = getFakeTerminalSession(inputRequest?.sessionId);
							terminalAppendText(session, inputRequest?.text ?? "");
							requestTerminalEmit(session);
							return null;
						}
						case "terminal_input_key": {
							const inputRequest = args.request as
								| {
										sessionId?: string;
										action?: number;
										key?: number;
										utf8?: string | null;
								  }
								| undefined;
							const session = getFakeTerminalSession(inputRequest?.sessionId);
							// Only "press" (1) mutates the fake grid — matches this
							// fixture's simplified echo semantics (see the module
							// doc above); release/repeat are still accepted (and
							// still observable via `__PLAIN_TEST_TAURI_CALLS__`) but
							// have no visual effect here.
							if (inputRequest?.action === 1) {
								if (
									typeof inputRequest.utf8 === "string" &&
									inputRequest.utf8.length > 0
								) {
									terminalAppendText(session, inputRequest.utf8);
								} else if (inputRequest.key === 58 /* Enter */) {
									terminalAppendText(session, "\n");
								} else if (inputRequest.key === 53 /* Backspace */) {
									terminalBackspace(session);
								}
							}
							requestTerminalEmit(session);
							return null;
						}
						case "terminal_focus": {
							const focusRequest = args.request as
								{ sessionId?: string } | undefined;
							getFakeTerminalSession(focusRequest?.sessionId);
							return null;
						}
						case "terminal_resize": {
							const resizeRequest = args.request as
								| { sessionId?: string; cols?: number; rows?: number }
								| undefined;
							const session = getFakeTerminalSession(resizeRequest?.sessionId);
							session.cols = resizeRequest?.cols ?? session.cols;
							session.rows = resizeRequest?.rows ?? session.rows;
							session.lines.length = Math.min(
								session.lines.length,
								session.rows,
							);
							session.cursorRow = Math.min(
								session.cursorRow,
								Math.max(0, session.rows - 1),
							);
							session.cursorCol = Math.min(
								session.cursorCol,
								Math.max(0, session.cols - 1),
							);
							// A resize always produces a fresh full frame in the real
							// implementation regardless of outstanding-ack state —
							// mirrored here by emitting immediately rather than
							// through `requestTerminalEmit`'s single-outstanding
							// gate.
							session.awaitingAck = true;
							session.pendingEmit = false;
							emitTerminalFrame(session);
							return null;
						}
						case "terminal_ack": {
							const ackRequest = args.request as
								{ sessionId?: string } | undefined;
							const session = getFakeTerminalSession(ackRequest?.sessionId);
							session.awaitingAck = false;
							if (session.pendingEmit) {
								requestTerminalEmit(session);
							}
							return null;
						}
						case "terminal_scrollback": {
							const scrollbackRequest = args.request as
								| { sessionId?: string; start?: number; count?: number }
								| undefined;
							const session = getFakeTerminalSession(
								scrollbackRequest?.sessionId,
							);
							const start = scrollbackRequest?.start ?? 0;
							const count = scrollbackRequest?.count ?? 0;
							const slice = session.scrollback.slice(start, start + count);
							return {
								rows: slice.map((line, index) => ({
									rowIndex: start + index,
									cells: Array.from(
										{ length: session.cols },
										(_unused, col) => ({
											graphemes: line[col] ?? "",
											style: DEFAULT_TERMINAL_STYLE,
										}),
									),
								})),
							};
						}
						case "terminal_kill": {
							const killRequest = args.request as
								{ sessionId?: string } | undefined;
							const session = getFakeTerminalSession(killRequest?.sessionId);
							terminalSessions.delete(session.sessionId);
							// `F190` S6: mirrors `TerminalService::kill`'s own
							// `TerminalLifecycleMarkerStore::record_ended(window_label, 1)`
							// call — an explicit `terminal_kill` is, by construction,
							// always a "正常显式关闭" the marker must not keep counting.
							storeTerminalLifecycleMarker(
								Math.max(0, loadTerminalLifecycleMarker() - 1),
							);
							emitTerminalExit(session, 137);
							return null;
						}
						// `F190` S4 "Ghostty metadata and links": mirrors
						// `terminal::opener::open_external_link`'s own fail-closed
						// http(s)-only scheme check — see
						// `TerminalOpenExternalLinkRequest::into_parts`'s doc comment.
						// This fixture never actually launches a real OS opener; the
						// test itself observes the call via `terminalCallsFor(page,
						// "terminal_open_external_link")`.
						case "terminal_open_external_link": {
							const linkRequest = args.request as { url?: unknown } | undefined;
							if (
								typeof linkRequest?.url !== "string" ||
								linkRequest.url.length === 0 ||
								!/^https?:\/\//.test(linkRequest.url)
							) {
								throw Object.freeze({
									code: "TERMINAL_LINK_INVALID",
									message: "The requested link is not a valid http(s) URL.",
								});
							}
							return null;
						}
						// `F190` S6 "跨进程不伪造 session restore": mirrors
						// `TerminalService::claim_lifecycle_marker` — reads and
						// unconditionally clears this window's marker, reporting
						// whatever it held. Never touches `terminalSessions` (the real
						// command never kills a session on its own either — see that
						// method's own doc comment for why).
						case "terminal_lifecycle_marker": {
							const nonRestorableCount = loadTerminalLifecycleMarker();
							storeTerminalLifecycleMarker(0);
							return { nonRestorableCount };
						}
						case "git_status": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							return {
								branch: mockGitBranch,
								entries: mockGitEntries,
							};
						}
						case "git_diff_files": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							return { entries: [] };
						}
						case "git_show_blob": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							const showRequest = args.request as
								{ rev?: "head" | "index"; path?: string } | undefined;
							const rev = showRequest?.rev;
							const showPath = showRequest?.path;
							const text =
								rev !== undefined && showPath !== undefined
									? gitFixtureForTest.blobs?.[showPath]?.[rev]
									: undefined;
							return {
								content:
									text === undefined
										? null
										: Array.from(new TextEncoder().encode(text)),
							};
						}
						case "git_stage_paths": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							const request = args.request as { paths?: string[] } | undefined;
							for (const path of request?.paths ?? []) {
								stageOneMockGitPath(path, true);
							}
							return null;
						}
						case "git_unstage_paths": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							const request = args.request as { paths?: string[] } | undefined;
							for (const path of request?.paths ?? []) {
								unstageOneMockGitPath(path);
							}
							return null;
						}
						case "git_stage_blob": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							const request = args.request as
								{ path?: string; content?: number[] } | undefined;
							if (request?.path !== undefined) {
								stageOneMockGitPath(request.path, false);
							}
							return null;
						}
						case "git_commit": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							const request = args.request as
								{ message?: string; amend?: boolean } | undefined;
							if (request?.amend !== true && !mockGitHasStagedChanges()) {
								throw gitCommitNothingToCommit();
							}
							commitMockGitStagedEntries();
							return null;
						}
						case "git_discard_paths": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							const request = args.request as { paths?: string[] } | undefined;
							const paths = request?.paths ?? [];
							if (!paths.every((path) => mockGitPathIsDiscardable(path))) {
								throw gitDiscardFailed();
							}
							for (const path of paths) {
								discardOneMockGitPath(path);
							}
							return null;
						}
						case "git_network_preview": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (isMockGitRootRemote(args.rootId)) {
								throw gitRemoteNetworkUnsupported();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							const previewRequest = args.request as
								{ operation?: "fetch" | "pull" | "push" } | undefined;
							if (mockGitNetworkUpstream === null) {
								if (previewRequest?.operation === "fetch") {
									return { upstream: null, ahead: null, behind: null };
								}
								throw gitNetworkNoUpstream();
							}
							return {
								upstream: mockGitNetworkUpstream,
								ahead: mockGitNetworkAhead,
								behind: mockGitNetworkBehind,
							};
						}
						case "git_fetch": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (isMockGitRootRemote(args.rootId)) {
								throw gitRemoteNetworkUnsupported();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							if (gitNetworkFixtureForTest.delayMs) {
								await new Promise((resolve) =>
									setTimeout(resolve, gitNetworkFixtureForTest.delayMs),
								);
							}
							// A real fetch only updates the remote-tracking ref, never
							// the local branch/ahead-behind-vs-HEAD numbers this
							// simulation tracks — mirrors `browser-mock.ts`'s own
							// `gitFetch`, which is a no-op success regardless of
							// upstream state.
							return null;
						}
						case "git_pull": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (isMockGitRootRemote(args.rootId)) {
								throw gitRemoteNetworkUnsupported();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							if (gitNetworkFixtureForTest.delayMs) {
								await new Promise((resolve) =>
									setTimeout(resolve, gitNetworkFixtureForTest.delayMs),
								);
							}
							if (mockGitNetworkUpstream === null) {
								throw gitNetworkNoUpstream();
							}
							mockGitNetworkBehind = 0;
							return null;
						}
						case "git_push": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (isMockGitRootRemote(args.rootId)) {
								throw gitRemoteNetworkUnsupported();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							if (gitNetworkFixtureForTest.delayMs) {
								await new Promise((resolve) =>
									setTimeout(resolve, gitNetworkFixtureForTest.delayMs),
								);
							}
							const pushRequest = args.request as
								{ force?: boolean } | undefined;
							const force = pushRequest?.force === true;
							if (mockGitNetworkUpstream === null) {
								throw gitNetworkNoUpstream();
							}
							if (force) {
								if (
									gitNetworkFixtureForTest.forcePushRejectedForTest === true
								) {
									throw gitPushRejected();
								}
							} else if (mockGitNetworkBehind > 0) {
								throw gitPushRejected();
							}
							mockGitNetworkAhead = 0;
							return null;
						}
						case "git_network_cancel": {
							return null;
						}
						case "git_blame_file": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							const blameRequest = args.request as
								| {
										path?: string;
										range?: { start: number; end: number } | null;
								  }
								| undefined;
							const fixture = mockGitBlame.get(blameRequest?.path ?? "") ?? {
								entries: [],
								commits: {},
							};
							if (!blameRequest?.range) {
								return fixture;
							}
							const { start, end } = blameRequest.range;
							const entries = fixture.entries.filter(
								(entry) => entry.finalLine >= start && entry.finalLine <= end,
							);
							const shas = new Set(entries.map((entry) => entry.commitSha));
							const commits: Record<string, TestGitBlameCommitHeader> = {};
							for (const [sha, header] of Object.entries(fixture.commits)) {
								if (shas.has(sha)) {
									commits[sha] = header;
								}
							}
							return { entries, commits };
						}
						case "git_blame_commit_messages": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							const shasRequest = args.request as
								{ shas?: string[] } | undefined;
							const messages: Record<string, string> = {};
							for (const sha of shasRequest?.shas ?? []) {
								const message = mockGitBlameCommitMessages.get(sha);
								if (message !== undefined) {
									messages[sha] = message;
								}
							}
							return { messages };
						}
						case "git_file_history": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							const historyRequest = args.request as
								{ path?: string } | undefined;
							return (
								mockGitFileHistory.get(historyRequest?.path ?? "") ?? {
									entries: [],
									truncated: false,
								}
							);
						}
						case "git_line_history_list": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							const lineListRequest = args.request as
								{ path?: string } | undefined;
							return (
								mockGitLineHistoryList.get(lineListRequest?.path ?? "") ?? {
									entries: [],
									truncated: false,
								}
							);
						}
						case "git_line_history_detail": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							const detailRequest = args.request as
								| { path?: string; skip?: number; expectedSha?: string }
								| undefined;
							const list = mockGitLineHistoryList.get(
								detailRequest?.path ?? "",
							) ?? { entries: [], truncated: false };
							const entry = list.entries[detailRequest?.skip ?? -1];
							if (entry === undefined) {
								throw {
									code: "GIT_LINE_HISTORY_DETAIL_NOT_FOUND",
									message:
										"No commit exists at the requested position in this line's history.",
								};
							}
							if (entry.sha !== detailRequest?.expectedSha) {
								throw {
									code: "GIT_LINE_HISTORY_DETAIL_STALE_INDEX",
									message:
										"The line's history has changed since it was listed; refresh and try again.",
								};
							}
							return (
								mockGitLineHistoryDetail.get(entry.sha) ?? {
									sha: entry.sha,
									diffText: `commit ${entry.sha}\n\n    ${entry.message}\n`,
								}
							);
						}
						case "git_show_commit": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							const showCommitRequest = args.request as
								{ sha?: string } | undefined;
							const sha = showCommitRequest?.sha ?? "";
							return (
								mockGitShowCommit.get(sha) ?? {
									sha,
									parentSha: null,
									files: [],
								}
							);
						}
						case "git_show_commit_blob": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							const showBlobRequest = args.request as
								{ sha?: string; path?: string } | undefined;
							const content = mockGitCommitBlobs.get(
								showBlobRequest?.sha ?? "",
							)?.[showBlobRequest?.path ?? ""];
							return {
								content:
									content === undefined
										? null
										: Array.from(new TextEncoder().encode(content)),
							};
						}
						case "git_log_graph": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							return mockGitGraph;
						}
						case "git_refs_list": {
							ensureMockGitManagementAvailable(args.rootId);
							return mockGitRefsSnapshot();
						}
						case "git_remotes_list": {
							ensureMockGitManagementAvailable(args.rootId);
							return mockGitRemotesSnapshot();
						}
						case "git_branch_create": {
							ensureMockGitManagementAvailable(args.rootId);
							const request = args.request as
								{ name?: string; targetSha?: string } | undefined;
							if (mockGitLocalBranch(request?.name ?? "") !== undefined) {
								throw mockGitManagementError(
									"GIT_BRANCH_ALREADY_EXISTS",
									"A Git branch with that name already exists.",
								);
							}
							mockGitRefEntries.push({
								kind: "branch",
								fullName: `refs/heads/${request?.name ?? ""}`,
								shortName: request?.name ?? "",
								targetSha: request?.targetSha ?? "",
								isAnnotatedTag: false,
								peeledSha: null,
								upstream: null,
								isHead: false,
							});
							return null;
						}
						case "git_branch_switch": {
							ensureMockGitManagementAvailable(args.rootId);
							const request = args.request as { name?: string } | undefined;
							const branch = mockGitLocalBranch(request?.name ?? "");
							if (branch === undefined) {
								throw mockGitManagementError(
									"GIT_BRANCH_NOT_FOUND",
									"The requested Git branch does not exist.",
								);
							}
							mockGitRefEntries = mockGitRefEntries.map((entry) =>
								entry.kind === "branch"
									? { ...entry, isHead: entry.shortName === branch.shortName }
									: entry,
							);
							const upstream = branch.upstream?.startsWith("refs/remotes/")
								? branch.upstream.slice("refs/remotes/".length)
								: null;
							mockGitBranch = {
								oid: branch.targetSha,
								head: branch.shortName,
								upstream:
									upstream === null
										? null
										: { name: upstream, ahead: 0, behind: 0 },
							};
							mockGitNetworkUpstream = upstream;
							return null;
						}
						case "git_branch_rename": {
							ensureMockGitManagementAvailable(args.rootId);
							const request = args.request as
								{ oldName?: string; newName?: string } | undefined;
							const branch = mockGitLocalBranch(request?.oldName ?? "");
							if (branch === undefined) {
								throw mockGitManagementError(
									"GIT_BRANCH_NOT_FOUND",
									"The requested Git branch does not exist.",
								);
							}
							if (mockGitLocalBranch(request?.newName ?? "") !== undefined) {
								throw mockGitManagementError(
									"GIT_BRANCH_ALREADY_EXISTS",
									"A Git branch with that name already exists.",
								);
							}
							mockGitRefEntries = mockGitRefEntries.map((entry) =>
								entry === branch
									? {
											...entry,
											fullName: `refs/heads/${request?.newName ?? ""}`,
											shortName: request?.newName ?? "",
										}
									: entry,
							);
							if (mockGitBranch.head === request?.oldName) {
								mockGitBranch = {
									...mockGitBranch,
									head: request?.newName ?? "",
								};
							}
							if (mockGitUnmergedBranches.delete(request?.oldName ?? "")) {
								mockGitUnmergedBranches.add(request?.newName ?? "");
							}
							return null;
						}
						case "git_branch_delete": {
							ensureMockGitManagementAvailable(args.rootId);
							const request = args.request as
								{ name?: string; force?: boolean } | undefined;
							const branch = mockGitLocalBranch(request?.name ?? "");
							if (branch === undefined) {
								throw mockGitManagementError(
									"GIT_BRANCH_NOT_FOUND",
									"The requested Git branch does not exist.",
								);
							}
							if (branch.isHead || mockGitBranch.head === branch.shortName) {
								throw mockGitManagementError(
									"GIT_BRANCH_IS_CURRENT",
									"The currently checked-out Git branch cannot be deleted.",
								);
							}
							if (
								request?.force !== true &&
								mockGitUnmergedBranches.has(branch.shortName)
							) {
								return "needsForce";
							}
							mockGitRefEntries = mockGitRefEntries.filter(
								(entry) => entry !== branch,
							);
							mockGitUnmergedBranches.delete(branch.shortName);
							return "deleted";
						}
						case "git_tag_create": {
							ensureMockGitManagementAvailable(args.rootId);
							const request = args.request as
								| { name?: string; targetSha?: string; message?: string | null }
								| undefined;
							if (mockGitTag(request?.name ?? "") !== undefined) {
								throw mockGitManagementError(
									"GIT_TAG_ALREADY_EXISTS",
									"A Git tag with that name already exists.",
								);
							}
							const targetSha = request?.targetSha ?? "";
							const annotated = request?.message != null;
							mockGitRefEntries.push({
								kind: "tag",
								fullName: `refs/tags/${request?.name ?? ""}`,
								shortName: request?.name ?? "",
								targetSha,
								isAnnotatedTag: annotated,
								peeledSha: annotated ? targetSha : null,
								upstream: null,
								isHead: false,
							});
							return null;
						}
						case "git_tag_delete": {
							ensureMockGitManagementAvailable(args.rootId);
							const request = args.request as { name?: string } | undefined;
							const tag = mockGitTag(request?.name ?? "");
							if (tag === undefined) {
								throw mockGitManagementError(
									"GIT_TAG_NOT_FOUND",
									"The requested Git tag does not exist.",
								);
							}
							mockGitRefEntries = mockGitRefEntries.filter(
								(entry) => entry !== tag,
							);
							return null;
						}
						case "git_remote_add": {
							ensureMockGitManagementAvailable(args.rootId);
							const request = args.request as
								{ name?: string; url?: string } | undefined;
							if (mockGitRemote(request?.name ?? "") !== undefined) {
								throw mockGitManagementError(
									"GIT_REMOTE_ALREADY_EXISTS",
									"A Git remote with that name already exists.",
								);
							}
							mockGitRemoteEntries.push({
								name: request?.name ?? "",
								fetchUrls: [redactMockGitRemoteUrl(request?.url ?? "")],
								pushUrls: [],
							});
							return null;
						}
						case "git_remote_rename": {
							ensureMockGitManagementAvailable(args.rootId);
							const request = args.request as
								{ oldName?: string; newName?: string } | undefined;
							const remote = mockGitRemote(request?.oldName ?? "");
							if (remote === undefined) {
								throw mockGitManagementError(
									"GIT_REMOTE_NOT_FOUND",
									"The requested Git remote does not exist.",
								);
							}
							if (mockGitRemote(request?.newName ?? "") !== undefined) {
								throw mockGitManagementError(
									"GIT_REMOTE_ALREADY_EXISTS",
									"A Git remote with that name already exists.",
								);
							}
							const oldName = remote.name;
							const newName = request?.newName ?? "";
							mockGitRemoteEntries = mockGitRemoteEntries.map((entry) =>
								entry === remote ? { ...entry, name: newName } : entry,
							);
							const oldShortPrefix = `${oldName}/`;
							const oldFullPrefix = `refs/remotes/${oldName}/`;
							mockGitRefEntries = mockGitRefEntries.map((entry) => {
								if (
									entry.kind === "remoteBranch" &&
									entry.shortName.startsWith(oldShortPrefix)
								) {
									const suffix = entry.shortName.slice(oldShortPrefix.length);
									return {
										...entry,
										shortName: `${newName}/${suffix}`,
										fullName: `refs/remotes/${newName}/${suffix}`,
									};
								}
								return entry.upstream?.startsWith(oldFullPrefix) === true
									? {
											...entry,
											upstream: `refs/remotes/${newName}/${entry.upstream.slice(oldFullPrefix.length)}`,
										}
									: entry;
							});
							if (mockGitNetworkUpstream?.startsWith(oldShortPrefix)) {
								mockGitNetworkUpstream = `${newName}/${mockGitNetworkUpstream.slice(oldShortPrefix.length)}`;
							}
							if (mockGitBranch.upstream?.name.startsWith(oldShortPrefix)) {
								mockGitBranch = {
									...mockGitBranch,
									upstream: {
										...mockGitBranch.upstream,
										name: `${newName}/${mockGitBranch.upstream.name.slice(oldShortPrefix.length)}`,
									},
								};
							}
							return null;
						}
						case "git_remote_set_url": {
							ensureMockGitManagementAvailable(args.rootId);
							const request = args.request as
								| { name?: string; kind?: "fetch" | "push"; url?: string }
								| undefined;
							const remote = mockGitRemote(request?.name ?? "");
							if (remote === undefined) {
								throw mockGitManagementError(
									"GIT_REMOTE_NOT_FOUND",
									"The requested Git remote does not exist.",
								);
							}
							const display = redactMockGitRemoteUrl(request?.url ?? "");
							mockGitRemoteEntries = mockGitRemoteEntries.map((entry) =>
								entry === remote
									? {
											...entry,
											fetchUrls:
												request?.kind === "fetch" ? [display] : entry.fetchUrls,
											pushUrls:
												request?.kind === "push" ? [display] : entry.pushUrls,
										}
									: entry,
							);
							return null;
						}
						case "git_remote_remove": {
							ensureMockGitManagementAvailable(args.rootId);
							const request = args.request as { name?: string } | undefined;
							const remote = mockGitRemote(request?.name ?? "");
							if (remote === undefined) {
								throw mockGitManagementError(
									"GIT_REMOTE_NOT_FOUND",
									"The requested Git remote does not exist.",
								);
							}
							mockGitRemoteEntries = mockGitRemoteEntries.filter(
								(entry) => entry !== remote,
							);
							const shortPrefix = `${remote.name}/`;
							const fullPrefix = `refs/remotes/${remote.name}/`;
							mockGitRefEntries = mockGitRefEntries
								.filter(
									(entry) =>
										entry.kind !== "remoteBranch" ||
										!entry.shortName.startsWith(shortPrefix),
								)
								.map((entry) =>
									entry.upstream?.startsWith(fullPrefix) === true
										? { ...entry, upstream: null }
										: entry,
								);
							if (mockGitNetworkUpstream?.startsWith(shortPrefix)) {
								mockGitNetworkUpstream = null;
							}
							if (mockGitBranch.upstream?.name.startsWith(shortPrefix)) {
								mockGitBranch = { ...mockGitBranch, upstream: null };
							}
							return null;
						}
						case "git_upstream_set": {
							ensureMockGitManagementAvailable(args.rootId);
							const request = args.request as
								{ branch?: string; upstream?: string } | undefined;
							const branch = mockGitLocalBranch(request?.branch ?? "");
							const remoteBranch = mockGitRefEntries.find(
								(entry) =>
									entry.kind === "remoteBranch" &&
									entry.shortName === request?.upstream,
							);
							const upstream = request?.upstream ?? "";
							const remoteName = upstream.slice(0, upstream.indexOf("/"));
							if (
								branch === undefined ||
								remoteBranch === undefined ||
								mockGitRemote(remoteName) === undefined
							) {
								throw mockGitManagementError(
									"GIT_UPSTREAM_NOT_FOUND",
									"The requested upstream does not exist.",
								);
							}
							mockGitRefEntries = mockGitRefEntries.map((entry) =>
								entry === branch
									? { ...entry, upstream: `refs/remotes/${upstream}` }
									: entry,
							);
							if (mockGitBranch.head === branch.shortName) {
								mockGitNetworkUpstream = upstream;
								mockGitBranch = {
									...mockGitBranch,
									upstream: { name: upstream, ahead: 0, behind: 0 },
								};
							}
							return null;
						}
						case "git_upstream_unset": {
							ensureMockGitManagementAvailable(args.rootId);
							const request = args.request as { branch?: string } | undefined;
							const branch = mockGitLocalBranch(request?.branch ?? "");
							if (branch === undefined || branch.upstream === null) {
								throw mockGitManagementError(
									"GIT_UPSTREAM_NOT_CONFIGURED",
									"The requested local branch has no configured upstream.",
								);
							}
							mockGitRefEntries = mockGitRefEntries.map((entry) =>
								entry === branch ? { ...entry, upstream: null } : entry,
							);
							if (mockGitBranch.head === branch.shortName) {
								mockGitNetworkUpstream = null;
								mockGitBranch = { ...mockGitBranch, upstream: null };
							}
							return null;
						}
						case "git_reflog_list": {
							ensureMockGitManagementAvailable(args.rootId);
							return {
								entries: mockGitReflog.entries.map((entry) => ({ ...entry })),
								truncated: mockGitReflog.truncated,
							};
						}
						case "git_contributors_list": {
							ensureMockGitManagementAvailable(args.rootId);
							return {
								entries: mockGitContributors.entries.map((entry) => ({
									...entry,
								})),
								truncated: mockGitContributors.truncated,
							};
						}
						case "git_history_state": {
							ensureMockGitManagementAvailable(args.rootId);
							return mockGitHistoryState();
						}
						case "git_history_preview": {
							ensureMockGitManagementAvailable(args.rootId);
							const historyRequest = args.request as
								| {
										operation?: TestGitHistoryOperation;
										targetSha?: string;
								  }
								| undefined;
							const operation = historyRequest?.operation ?? "merge";
							const targetSha = historyRequest?.targetSha ?? "";
							mockGitHistoryPreviewCounter += 1;
							const previewToken = mockGitHistoryPreviewCounter
								.toString(16)
								.padStart(64, "0");
							mockGitHistoryPreview = { operation, targetSha, previewToken };
							return {
								operation,
								targetSha,
								headSha: mockGitBranch.oid,
								ahead: 0,
								behind: 0,
								...mockGitHistoryPaths(),
								sequencer: mockGitHistoryState().sequencer,
								previewToken,
							};
						}
						case "git_merge":
						case "git_rebase":
						case "git_cherry_pick":
						case "git_revert": {
							ensureMockGitManagementAvailable(args.rootId);
							const targetedRequest = args.request as
								{ targetSha?: string; previewToken?: string } | undefined;
							const operation = {
								git_merge: "merge",
								git_rebase: "rebase",
								git_cherry_pick: "cherryPick",
								git_revert: "revert",
							}[command] as TestGitHistoryOperation;
							return executeMockGitHistoryOperation(
								operation,
								targetedRequest?.targetSha ?? "",
								targetedRequest?.previewToken ?? "",
							);
						}
						case "git_reset": {
							ensureMockGitManagementAvailable(args.rootId);
							const resetRequest = args.request as
								| {
										targetSha?: string;
										mode?: "soft" | "mixed" | "hard";
										previewToken?: string;
								  }
								| undefined;
							const operation = {
								soft: "resetSoft",
								mixed: "resetMixed",
								hard: "resetHard",
							}[resetRequest?.mode ?? "hard"] as TestGitHistoryOperation;
							return executeMockGitHistoryOperation(
								operation,
								resetRequest?.targetSha ?? "",
								resetRequest?.previewToken ?? "",
							);
						}
						case "git_history_continue": {
							ensureMockGitManagementAvailable(args.rootId);
							const continueRequest = args.request as
								{ kind?: TestGitSequencerKind } | undefined;
							if (
								mockGitHistorySequencer === null ||
								mockGitHistorySequencer.kind !== continueRequest?.kind
							) {
								throw {
									code: "GIT_HISTORY_OPERATION_KIND_CHANGED",
									message:
										"The in-progress Git operation changed. Refresh its state before continuing.",
								};
							}
							mockGitHistorySequencer = null;
							mockGitHistoryCommitCounter += 1;
							mockGitBranch = {
								...mockGitBranch,
								oid: mockGitHistoryCommitCounter.toString(16).padStart(40, "0"),
							};
							return { kind: "completed", state: mockGitHistoryState() };
						}
						case "git_history_abort": {
							ensureMockGitManagementAvailable(args.rootId);
							const abortRequest = args.request as
								{ kind?: TestGitSequencerKind } | undefined;
							if (
								mockGitHistorySequencer === null ||
								mockGitHistorySequencer.kind !== abortRequest?.kind
							) {
								throw {
									code: "GIT_HISTORY_OPERATION_KIND_CHANGED",
									message:
										"The in-progress Git operation changed. Refresh its state before continuing.",
								};
							}
							mockGitHistorySequencer = null;
							return { kind: "completed", state: mockGitHistoryState() };
						}
						case "git_history_cancel": {
							ensureMockGitManagementAvailable(args.rootId);
							if (mockGitHistoryInFlight !== undefined) {
								mockGitHistoryInFlight.cancelled = true;
							}
							return null;
						}
						case "git_stash_list": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							return {
								entries: mockGitStashEntries.map((entry, index) => ({
									...entry,
									index,
								})),
								truncated: false,
							};
						}
						case "git_stash_show": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							const stashShowRequest = args.request as
								{ sha?: string } | undefined;
							const sha = stashShowRequest?.sha ?? "";
							if (!mockGitStashEntries.some((entry) => entry.sha === sha)) {
								throw gitStashNotFound();
							}
							return (
								mockGitStashShow.get(sha) ?? {
									sha,
									parentSha: null,
									files: [],
								}
							);
						}
						case "git_stash_push": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							const stashPushRequest = args.request as
								{ message?: string } | undefined;
							mockGitStashCounter += 1;
							const sha = `f0${mockGitStashCounter.toString(16).padStart(38, "0")}`;
							mockGitStashEntries.unshift({
								index: 0,
								sha,
								committerTime: Math.floor(Date.now() / 1000),
								message: stashPushRequest?.message ?? "",
							});
							return "created";
						}
						case "git_stash_apply": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							const stashApplyRequest = args.request as
								{ sha?: string } | undefined;
							const sha = stashApplyRequest?.sha ?? "";
							if (!mockGitStashEntries.some((entry) => entry.sha === sha)) {
								throw gitStashNotFound();
							}
							const conflictedPaths = mockGitStashConflicts.get(sha);
							if (conflictedPaths !== undefined) {
								return { kind: "conflict", conflictedPaths };
							}
							return { kind: "applied" };
						}
						case "git_stash_pop": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							const stashPopRequest = args.request as
								{ expectedSha?: string } | undefined;
							const expectedSha = stashPopRequest?.expectedSha ?? "";
							const index = mockGitStashEntries.findIndex(
								(entry) => entry.sha === expectedSha,
							);
							if (index === -1) {
								throw gitStashNotFound();
							}
							const conflictedPaths = mockGitStashConflicts.get(expectedSha);
							if (conflictedPaths !== undefined) {
								return { kind: "conflict", conflictedPaths };
							}
							mockGitStashEntries.splice(index, 1);
							return { kind: "applied" };
						}
						case "git_stash_drop": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							const stashDropRequest = args.request as
								{ expectedSha?: string } | undefined;
							const expectedSha = stashDropRequest?.expectedSha ?? "";
							const index = mockGitStashEntries.findIndex(
								(entry) => entry.sha === expectedSha,
							);
							if (index === -1) {
								throw gitStashNotFound();
							}
							mockGitStashEntries.splice(index, 1);
							return null;
						}
						case "git_worktree_list": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							return {
								entries: mockGitWorktreeEntries.map((entry) => ({ ...entry })),
								truncated: false,
							};
						}
						case "git_worktree_add": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							const worktreeAddRequest = args.request as
								| {
										childSegment?: string;
										detach?: boolean;
										commitIsh?: string | null;
								  }
								| undefined;
							if (gitFixtureForTest.worktreeAddCancelledForTest === true) {
								return { kind: "pickerCancelled" };
							}
							mockGitWorktreeCounter += 1;
							const worktreeSha = `a0${mockGitWorktreeCounter.toString(16).padStart(38, "0")}`;
							const childSegment = worktreeAddRequest?.childSegment ?? "";
							const worktreePath = `/workspace-worktrees/${childSegment}`;
							mockGitWorktreeEntries.push({
								path: worktreePath,
								headSha: worktreeSha,
								headState: worktreeAddRequest?.detach
									? { kind: "detached" }
									: {
											kind: "branch",
											refName: `refs/heads/${worktreeAddRequest?.commitIsh ?? childSegment}`,
										},
								lockReason: null,
								prunableReason: null,
								isMain: false,
							});
							return { kind: "added", path: worktreePath };
						}
						case "git_worktree_remove": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							const worktreeRemoveRequest = args.request as
								{ path?: string; force?: boolean } | undefined;
							const worktreeRemovePath = worktreeRemoveRequest?.path ?? "";
							const worktreeEntry = mockGitWorktreeEntries.find(
								(candidate) => candidate.path === worktreeRemovePath,
							);
							if (worktreeEntry === undefined) {
								throw {
									code: "GIT_WORKTREE_REMOVE_NOT_FOUND",
									message:
										"That path is not a registered worktree of this repository.",
								};
							}
							if (worktreeEntry.isMain) {
								throw {
									code: "GIT_WORKTREE_REMOVE_IS_MAIN_WORKTREE",
									message: "The main worktree cannot be removed.",
								};
							}
							if (worktreeEntry.lockReason !== null) {
								throw {
									code: "GIT_WORKTREE_REMOVE_LOCKED",
									message:
										"This worktree is locked and must be unlocked before it can be removed.",
								};
							}
							if (
								!worktreeRemoveRequest?.force &&
								mockGitWorktreeDirtyPaths.has(worktreeRemovePath)
							) {
								return "needsForce";
							}
							mockGitWorktreeEntries = mockGitWorktreeEntries.filter(
								(candidate) => candidate.path !== worktreeRemovePath,
							);
							mockGitWorktreeDirtyPaths.delete(worktreeRemovePath);
							return "removed";
						}
						default:
							throw new Error(`Unexpected Tauri test command: ${command}`);
					}
				},
			};
		},
		{
			goldenRead: workspaceVersionFixture.read,
			mode,
			rawReadTransport,
			pngBase64: MINIMAL_PNG_BASE64,
			extraFiles,
			textSearchMaxMatchesForTest,
			textSearchMaxFileSizeForTest,
			textSearchPollDelayMsForTest,
			themeLibraryFixtureForTest,
			themeImportOutcomesForTest,
			themeSelectionForTest,
			fileIconThemeSelectionForTest,
			productIconThemeSelectionForTest,
			terminalTrustedForTest,
			gitFixtureForTest,
			gitNetworkFixtureForTest,
			debugFixtureForTest,
			untitledFixtureForTest,
			trashOutcomesForTest,
			trashBeginFailuresForTest,
			terminalLifecycleMarkerForTest,
			remoteFixtureForTest,
		},
	);
}

async function installMultiRootNativeIpcMock(
	page: Page,
	mode: NativeIpcMockMode = "readonly",
	moveIncompleteScenarios: readonly TestMultiRootMoveIncompleteScenario[] = [],
	deleteIncompleteScenarios: readonly TestMultiRootDeleteIncompleteScenario[] = [],
	persistBackupsForTest: boolean = false,
	workspaceFilePicks: readonly ("selected" | "cancelled")[] = [],
): Promise<void> {
	await page.addInitScript(
		({
			mode,
			moveIncompleteScenarios,
			deleteIncompleteScenarios,
			workspaceId,
			primaryRootId,
			secondaryRootId,
			persistBackupsForTest,
			workspaceFilePicks,
		}) => {
			type MockFile = {
				kind: "file";
				bytes: Uint8Array;
				version: string;
			};
			type MockDirectory = Readonly<{
				kind: "directory";
				entries: Map<string, MockNode>;
			}>;
			type MockNode = MockFile | MockDirectory;
			type MockWorkspaceRoot = Readonly<{
				rootId: string;
				displayName: string;
				uri: string;
			}>;
			type WatchRootRequest = Readonly<{
				rootId: string;
				acknowledgedGeneration: number | null;
			}>;
			type WatchPendingRoot = Readonly<{
				rootId: string;
				generation: number;
				rescanRequired: boolean;
			}>;
			type WatchState = {
				nextGeneration: number;
				pending: WatchPendingRoot | undefined;
				dirty: boolean;
				dirtyRescanRequired: boolean;
			};
			type DeferredExternalCreate = Readonly<{
				rootId: string;
				name: string;
				emitWake: boolean;
				resolve(deliveries: number): void;
				reject(reason: unknown): void;
			}>;

			const calls: Array<{
				command: string;
				args: Record<string, unknown>;
			}> = [];
			const userDataEntries = new Map<
				"settings" | "keybindings",
				{ revision: number; content: string }
			>([
				["settings", { revision: 1, content: "{}\n" }],
				["keybindings", { revision: 1, content: "[]\n" }],
			]);
			const watchExchanges: Array<{
				callIndex: number;
				request: { roots: WatchRootRequest[] };
				result: { workspaceId: string; roots: WatchPendingRoot[] };
			}> = [];
			const watchExchangeTimings: TestWorkspaceWatchExchangeTiming[] = [];
			const externalCreateTimings: TestMultiRootExternalCreateTiming[] = [];
			const versionTransitions: TestWorkspaceVersionTransition[] = [];
			const primaryRoot = Object.freeze({
				rootId: primaryRootId,
				displayName: "plain-workspace",
				uri: `plain-workspace://${primaryRootId}/`,
			});
			const secondaryRoot = Object.freeze({
				rootId: secondaryRootId,
				displayName: "plain-library",
				uri: `plain-workspace://${secondaryRootId}/`,
			});
			const gitSubmodule = Object.freeze({
				isSubmodule: false,
				commitChanged: false,
				trackedChanged: false,
				untrackedChanged: false,
			});
			const gitOrdinaryEntry = (
				path: string,
				indexStatus: string,
				worktreeStatus: string,
			) => ({
				type: "ordinary" as const,
				indexStatus,
				worktreeStatus,
				submodule: gitSubmodule,
				modeHead: "100644",
				modeIndex: "100644",
				modeWorktree: "100644",
				hashHead: "a".repeat(40),
				hashIndex: "b".repeat(40),
				path,
			});
			const gitBranchesByRoot = new Map([
				[
					primaryRootId,
					{
						oid: "1".repeat(40),
						head: "primary-main",
						upstream: null,
					},
				],
				[
					secondaryRootId,
					{
						oid: "2".repeat(40),
						head: "secondary-main",
						upstream: null,
					},
				],
			] as const);
			const gitEntriesByRoot = new Map<string, Array<Record<string, unknown>>>([
				[primaryRootId, [gitOrdinaryEntry("primary-only.txt", ".", "M")]],
				[secondaryRootId, [{ type: "untracked", path: "secondary-only.txt" }]],
			]);
			const gitRefsByRoot = new Map<string, TestGitRefEntry[]>(
				[...gitBranchesByRoot].map(([rootId, branch]) => [
					rootId,
					[
						{
							kind: "branch",
							fullName: `refs/heads/${branch.head}`,
							shortName: branch.head,
							targetSha: branch.oid,
							isAnnotatedTag: false,
							peeledSha: null,
							upstream: null,
							isHead: true,
						},
					],
				]),
			);
			function selectedGitRootId(args: Record<string, unknown>): string {
				const selectedRootId = args.rootId;
				if (
					typeof selectedRootId !== "string" ||
					!activeRoots.has(selectedRootId) ||
					!gitBranchesByRoot.has(selectedRootId)
				) {
					throw rootNotAuthorized();
				}
				return selectedRootId;
			}
			const encoder = new TextEncoder();
			const decoder = new TextDecoder();
			// Most callers keep this purely in-memory. F160's process-boundary
			// scenario opts into sessionStorage so a page reload can stand in for
			// a fresh WebView while preserving the native store's root-bound data.
			const BACKUP_STORAGE_KEY = "__plain_test_multi_root_backup_store__";
			const loadBackupEntries = (): Map<
				string,
				{ rootId: string; key: string; bytes: Uint8Array }
			> => {
				if (!persistBackupsForTest) return new Map();
				const raw = sessionStorage.getItem(BACKUP_STORAGE_KEY);
				if (raw === null) return new Map();
				try {
					const parsed = JSON.parse(raw) as Array<
						[string, { rootId: string; key: string; bytes: number[] }]
					>;
					return new Map(
						parsed.map(([mapKey, entry]) => [
							mapKey,
							{ ...entry, bytes: Uint8Array.from(entry.bytes) },
						]),
					);
				} catch {
					return new Map();
				}
			};
			const backupEntries = loadBackupEntries();
			const persistBackupEntries = (): void => {
				if (!persistBackupsForTest) return;
				sessionStorage.setItem(
					BACKUP_STORAGE_KEY,
					JSON.stringify(
						[...backupEntries.entries()].map(([mapKey, entry]) => [
							mapKey,
							{ ...entry, bytes: [...entry.bytes] },
						]),
					),
				);
			};
			const backupMapKey = (entryRootId: string, key: string): string =>
				`${entryRootId}\0${key}`;
			const plb2Frame = (
				value: Uint8Array,
			): { rootId: string; key: string; content: Uint8Array } => {
				if (
					value.byteLength < 45 ||
					value[0] !== 0x50 ||
					value[1] !== 0x4c ||
					value[2] !== 0x42 ||
					value[3] !== 0x32
				) {
					throw new Error("Malformed PLB2 multi-root test frame.");
				}
				const view = new DataView(
					value.buffer,
					value.byteOffset,
					value.byteLength,
				);
				const frameRootId = decoder.decode(value.slice(4, 40));
				const keyLength = value[40]!;
				const contentLength = view.getUint32(41, false);
				if (45 + keyLength + contentLength !== value.byteLength) {
					throw new Error("Malformed PLB2 multi-root test frame length.");
				}
				const key = decoder.decode(value.slice(45, 45 + keyLength));
				const content = value.slice(45 + keyLength);
				return { rootId: frameRootId, key, content };
			};
			const encodeBackupReadAllFrame = (): Uint8Array => {
				const entries = [...backupEntries.values()].filter(({ rootId }) =>
					activeRoots.has(rootId),
				);
				let total = 8;
				const encoded = entries.map(({ rootId, key, bytes }) => {
					const keyBytes = encoder.encode(key);
					total += 36 + 5 + keyBytes.byteLength + bytes.byteLength;
					return { rootId, keyBytes, bytes };
				});
				const frame = new Uint8Array(total);
				const view = new DataView(frame.buffer);
				frame.set([0x50, 0x4c, 0x41, 0x32], 0); // "PLA2"
				view.setUint32(4, entries.length, false);
				let offset = 8;
				for (const { rootId, keyBytes, bytes } of encoded) {
					frame.set(encoder.encode(rootId), offset);
					offset += 36;
					frame[offset] = keyBytes.byteLength;
					offset += 1;
					view.setUint32(offset, bytes.byteLength, false);
					offset += 4;
					frame.set(keyBytes, offset);
					offset += keyBytes.byteLength;
					frame.set(bytes, offset);
					offset += bytes.byteLength;
				}
				return frame;
			};
			const moveIncompletePlan = [...moveIncompleteScenarios];
			const deleteIncompletePlan = [...deleteIncompleteScenarios];
			let versionSerial = 101;
			let deferredExternalCreate: DeferredExternalCreate | undefined;
			const nextVersion = (): string =>
				`wv1:${(versionSerial++).toString(16).padStart(64, "0")}`;
			const file = (content: string): MockFile => ({
				kind: "file",
				bytes: encoder.encode(content),
				version: nextVersion(),
			});
			const directory = (
				entries: readonly (readonly [string, MockNode])[],
			): MockDirectory =>
				Object.freeze({ kind: "directory", entries: new Map(entries) });
			const rebindNodeVersions = (node: MockNode): MockNode =>
				node.kind === "file"
					? {
							kind: "file",
							bytes: node.bytes,
							version: nextVersion(),
						}
					: directory(
							[...node.entries].map(([name, child]) => [
								name,
								rebindNodeVersions(child),
							]),
						);
			const primaryEntries: Array<readonly [string, MockNode]> = [
				["README.md", file("# Primary workspace\n")],
				[
					"main.py",
					file(
						"def primary():\n    marker = 'primary-debug'\n    print(marker)\n\nprimary()\n",
					),
				],
				[
					".vscode",
					directory([
						[
							"launch.json",
							file(
								JSON.stringify({
									version: "0.2.0",
									configurations: [
										{
											type: "primary-python",
											request: "launch",
											name: "Debug primary main.py",
											plainAdapter: {
												transport: "stdio",
												command: "/primary-debug-adapter",
												args: ["--root", "primary"],
											},
											program: "main.py",
										},
									],
								}),
							),
						],
					]),
				],
				["copy-source.txt", file("Copy across roots.\n")],
				["shared.txt", file("F140 shared primary\n")],
				["src", directory([])],
			];
			if (deleteIncompleteScenarios.includes("deleteRetained")) {
				primaryEntries.push([
					"delete-retained.txt",
					file("Retain this delete target.\n"),
				]);
			}
			const secondaryEntries: Array<readonly [string, MockNode]> = [
				[
					"main.py",
					file(
						"def secondary():\n    marker = 'secondary-debug'\n    print(marker)\n\nsecondary()\n",
					),
				],
				[
					".vscode",
					directory([
						[
							"launch.json",
							file(
								JSON.stringify({
									version: "0.2.0",
									configurations: [
										{
											type: "secondary-python",
											request: "launch",
											name: "Debug secondary main.py",
											plainAdapter: {
												transport: "stdio",
												command: "/secondary-debug-adapter",
												args: ["--root", "secondary"],
											},
											program: "main.py",
										},
									],
								}),
							),
						],
					]),
				],
				["move-source.txt", file("Move across roots.\n")],
				["notes.txt", file("Secondary workspace\n")],
				["shared.txt", file("F140 shared secondary\n")],
				["packages", directory([])],
			];
			if (moveIncompleteScenarios.includes("movePartial")) {
				secondaryEntries.push([
					"move-partial",
					directory([
						["removed.txt", file("Remove this source child.\n")],
						["kept.txt", file("Keep this source child.\n")],
					]),
				]);
			}
			if (deleteIncompleteScenarios.includes("deletePartial")) {
				secondaryEntries.push([
					"delete-partial",
					directory([
						["removed.txt", file("Remove this delete child.\n")],
						["kept.txt", file("Keep this delete child.\n")],
					]),
				]);
			}
			const trees = new Map<string, MockDirectory>([
				[primaryRootId, directory(primaryEntries)],
				[secondaryRootId, directory(secondaryEntries)],
			]);
			const activeRoots = new Map<string, MockWorkspaceRoot>();
			const scriptedFilePicks = [...workspaceFilePicks];
			let recentEntries: {
				entry: Readonly<{
					recentId: string;
					label: string;
					rootLabels: readonly string[];
					// `F220` S4: this mock has no remote-root support at all — every
					// entry it ever records is local-only — but the real wire
					// contract's `decodeWorkspaceRecentListResult` now requires the
					// key unconditionally (`hasExactKeys(..., ["recentId", "label",
					// "rootLabels", "remoteRoots"])`), so it must still be present,
					// always empty, here.
					remoteRoots: readonly [];
				}>;
				roots: readonly MockWorkspaceRoot[];
			}[] = [];
			let recentRevision = 1;
			let nextRecentId = 1;
			const watchStates = new Map<string, WatchState>();
			const terminalSessions = new Set<string>();
			let terminalSessionSerial = 1;
			const debugAdapterConfirmations = new Set<string>();
			const debugSessionRoots = new Map<string, string>();
			let debugSessionSerial = 801;
			let revision = 0;
			const nextTerminalSessionId = (): string => {
				const suffix = terminalSessionSerial.toString(16).padStart(12, "0");
				terminalSessionSerial += 1;
				return `00000000-0000-4000-8000-${suffix}`;
			};
			const nextDebugSessionId = (): string => {
				const suffix = debugSessionSerial.toString(16).padStart(12, "0");
				debugSessionSerial += 1;
				return `00000000-0000-4000-8000-${suffix}`;
			};
			const debugAdapterConfirmationKey = (request: {
				command?: unknown;
				args?: unknown;
				transport?: unknown;
			}): string =>
				JSON.stringify([request.command, request.args, request.transport]);
			const terminalSessionFrom = (args: Record<string, unknown>): string => {
				const request = args.request as { sessionId?: unknown } | undefined;
				if (
					typeof request?.sessionId !== "string" ||
					!terminalSessions.has(request.sessionId)
				) {
					throw {
						code: "TERMINAL_SESSION_NOT_FOUND",
						message: "The terminal session does not exist.",
					};
				}
				return request.sessionId;
			};

			const rootNotAuthorized = () => ({
				code: "ROOT_NOT_AUTHORIZED",
				message: "The workspace root is not authorized.",
			});
			const debugAdapterNotConfirmed = () => ({
				code: "DEBUG_ADAPTER_NOT_CONFIRMED",
				message:
					"This exact adapter command has not been confirmed for this workspace yet.",
			});
			const debugSessionNotFound = () => ({
				code: "DEBUG_SESSION_NOT_FOUND",
				message: "The debug session does not exist for this window and root.",
			});
			const entryNotFound = () => ({
				code: "ENTRY_NOT_FOUND",
				message: "The workspace entry does not exist.",
			});
			const entryAlreadyExists = () => ({
				code: "ENTRY_ALREADY_EXISTS",
				message: "The workspace entry already exists.",
			});
			const entryTypeMismatch = () => ({
				code: "ENTRY_TYPE_MISMATCH",
				message: "The workspace entry has an incompatible type.",
			});
			const invalidDeletePlan = () => ({
				code: "WORKSPACE_DELETE_PLAN_INVALID",
				message: "The workspace delete plan is invalid.",
			});
			const assertSupportedMutation = (): void => {
				if (mode !== "supported") {
					throw new Error("Unexpected readonly multi-root mutation.");
				}
			};
			const pathSegments = (relativePath: string): readonly string[] =>
				relativePath === "" ? [] : relativePath.split("/");
			const snapshot = () => ({
				workspaceId,
				revision,
				roots: [...activeRoots.values()],
			});
			const recordRecent = (): void => {
				const currentRoots = [...activeRoots.values()];
				recentRevision += 1;
				if (currentRoots.length === 0) return;
				const existingIndex = recentEntries.findIndex(
					(candidate) =>
						candidate.roots.length === currentRoots.length &&
						candidate.roots.every(
							(root, index) => root.rootId === currentRoots[index]?.rootId,
						),
				);
				const recentId =
					existingIndex >= 0
						? recentEntries.splice(existingIndex, 1)[0]!.entry.recentId
						: `00000000-0000-4000-8000-${(nextRecentId++).toString(16).padStart(12, "0")}`;
				const rootLabels = currentRoots.map(({ displayName }) => displayName);
				recentEntries.unshift({
					entry: {
						recentId,
						label:
							rootLabels.length === 1
								? rootLabels[0]!
								: `${rootLabels[0]} + ${rootLabels.length - 1} folders`,
						rootLabels,
						remoteRoots: [],
					},
					roots: [...currentRoots],
				});
				recentEntries = recentEntries.slice(0, 20);
			};
			const resolveNode = (rootId: string, relativePath: string): MockNode => {
				if (!activeRoots.has(rootId)) {
					throw rootNotAuthorized();
				}
				let node: MockNode | undefined = trees.get(rootId);
				if (node === undefined) {
					throw rootNotAuthorized();
				}
				for (const segment of pathSegments(relativePath)) {
					if (node.kind !== "directory") {
						throw entryTypeMismatch();
					}
					node = node.entries.get(segment);
					if (node === undefined) {
						throw entryNotFound();
					}
				}
				return node;
			};
			const resolveParent = (
				rootId: string,
				relativePath: string,
			): { parent: MockDirectory; name: string } => {
				const segments = pathSegments(relativePath);
				if (segments.length === 0) {
					throw entryTypeMismatch();
				}
				const name = segments.at(-1)!;
				const parent = resolveNode(rootId, segments.slice(0, -1).join("/"));
				if (parent.kind !== "directory") {
					throw entryTypeMismatch();
				}
				return { parent, name };
			};
			const descendantEntries = (node: MockNode): number => {
				if (node.kind === "file") {
					return 0;
				}
				let descendants = node.entries.size;
				for (const child of node.entries.values()) {
					descendants += descendantEntries(child);
				}
				return descendants;
			};
			const isSearchSubsequence = (
				pattern: string,
				candidate: string,
			): boolean => {
				let candidateIndex = 0;
				for (const patternCharacter of pattern) {
					let found = false;
					while (candidateIndex < candidate.length) {
						const candidateCharacter = candidate[candidateIndex]!;
						candidateIndex += 1;
						if (candidateCharacter === patternCharacter) {
							found = true;
							break;
						}
					}
					if (!found) {
						return false;
					}
				}
				return true;
			};
			const searchExcluded = (
				relativePath: string,
				excludeGlobs: readonly string[],
			): boolean =>
				excludeGlobs.some((glob) => {
					const token = glob.replace(/^\*\*\//u, "").replace(/\/\*\*$/u, "");
					return (
						token.length > 0 &&
						(relativePath === token ||
							relativePath.startsWith(`${token}/`) ||
							relativePath.split("/").includes(token))
					);
				});
			const searchFiles = (request: {
				roots: readonly string[];
				filePattern: string;
				excludeGlobs: readonly string[];
				maxResults: number;
			}): {
				entries: Array<{ rootId: string; path: string }>;
				limitHit: boolean;
			} => {
				const entries: Array<{ rootId: string; path: string }> = [];
				const pattern = request.filePattern.toLowerCase();
				for (const requestedRootId of request.roots) {
					if (!activeRoots.has(requestedRootId)) {
						throw rootNotAuthorized();
					}
					const tree = trees.get(requestedRootId);
					if (tree === undefined) {
						throw rootNotAuthorized();
					}
					const pending: Array<{ directory: MockDirectory; prefix: string }> = [
						{ directory: tree, prefix: "" },
					];
					while (pending.length > 0) {
						const frame = pending.pop()!;
						const children = [...frame.directory.entries].sort(
							([left], [right]) => left.localeCompare(right),
						);
						for (let index = children.length - 1; index >= 0; index -= 1) {
							const [name, child] = children[index]!;
							const path =
								frame.prefix === "" ? name : `${frame.prefix}/${name}`;
							if (searchExcluded(path, request.excludeGlobs)) {
								continue;
							}
							if (child.kind === "directory") {
								pending.push({ directory: child, prefix: path });
								continue;
							}
							if (
								pattern.length > 0 &&
								!isSearchSubsequence(pattern, path.toLowerCase())
							) {
								continue;
							}
							entries.push({ rootId: requestedRootId, path });
							if (entries.length >= request.maxResults) {
								return { entries, limitHit: true };
							}
						}
					}
				}
				return { entries, limitHit: false };
			};
			interface MultiRootTextSearchBatch {
				rootId: string;
				path: string;
				matches: Array<{
					line: number;
					column: number;
					length: number;
					previewText: string;
					absoluteColumn: number;
				}>;
			}
			let textSearchSerial = 301;
			let activeTextSearch:
				| {
						searchId: string;
						batches: MultiRootTextSearchBatch[];
						cursor: number;
						limitHit: boolean;
				  }
				| undefined;
			const nextTextSearchId = (): string =>
				`00000000-0000-4000-8000-${(textSearchSerial++)
					.toString()
					.padStart(12, "0")}`;
			const searchText = (request: {
				roots: readonly string[];
				pattern: string;
				isRegExp: boolean;
				isCaseSensitive: boolean;
				isWordMatch: boolean;
				excludeGlobs: readonly string[];
				maxResults: number;
				maxFileSize: number | null;
			}): { batches: MultiRootTextSearchBatch[]; limitHit: boolean } => {
				const source = request.isRegExp
					? request.pattern
					: request.pattern.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
				const matcher = new RegExp(
					request.isWordMatch ? `\\b(?:${source})\\b` : source,
					request.isCaseSensitive ? "gu" : "giu",
				);
				const batches: MultiRootTextSearchBatch[] = [];
				let remaining = request.maxResults;
				for (const requestedRootId of request.roots) {
					if (!activeRoots.has(requestedRootId)) {
						throw rootNotAuthorized();
					}
					const tree = trees.get(requestedRootId);
					if (tree === undefined) {
						throw rootNotAuthorized();
					}
					const pending: Array<{ directory: MockDirectory; prefix: string }> = [
						{ directory: tree, prefix: "" },
					];
					while (pending.length > 0) {
						const frame = pending.pop()!;
						for (const [name, child] of frame.directory.entries) {
							const path =
								frame.prefix === "" ? name : `${frame.prefix}/${name}`;
							if (searchExcluded(path, request.excludeGlobs)) {
								continue;
							}
							if (child.kind === "directory") {
								pending.push({ directory: child, prefix: path });
								continue;
							}
							if (
								request.maxFileSize !== null &&
								child.bytes.byteLength > request.maxFileSize
							) {
								continue;
							}
							const matches: MultiRootTextSearchBatch["matches"] = [];
							const lines = decoder.decode(child.bytes).split("\n");
							for (const [lineIndex, line] of lines.entries()) {
								matcher.lastIndex = 0;
								for (const match of line.matchAll(matcher)) {
									if (remaining <= 0) {
										return { batches, limitHit: true };
									}
									matches.push({
										line: lineIndex + 1,
										column: match.index + 1,
										length: match[0].length,
										previewText: line,
										absoluteColumn: match.index + 1,
									});
									remaining -= 1;
								}
							}
							if (matches.length > 0) {
								batches.push({ rootId: requestedRootId, path, matches });
							}
						}
					}
				}
				return { batches, limitHit: false };
			};
			const hexFromBytes = (bytes: Uint8Array): string =>
				[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
			const plw1Frame = (value: Uint8Array) => {
				if (
					value.byteLength < 14 ||
					value[0] !== 0x50 ||
					value[1] !== 0x4c ||
					value[2] !== 0x57 ||
					value[3] !== 0x31
				) {
					throw new Error("Malformed PLW1 multi-root browser test frame.");
				}
				const view = new DataView(
					value.buffer,
					value.byteOffset,
					value.byteLength,
				);
				const rootLength = view.getUint16(4, false);
				const pathLength = view.getUint16(6, false);
				const versionLength = view.getUint16(8, false);
				const contentLength = view.getUint32(10, false);
				if (
					14 + rootLength + pathLength + versionLength + contentLength !==
					value.byteLength
				) {
					throw new Error(
						"Malformed PLW1 multi-root browser test frame length.",
					);
				}
				let offset = 14;
				const rootId = decoder.decode(value.slice(offset, offset + rootLength));
				offset += rootLength;
				const relativePath = decoder.decode(
					value.slice(offset, offset + pathLength),
				);
				offset += pathLength;
				const expectedVersion = decoder.decode(
					value.slice(offset, offset + versionLength),
				);
				offset += versionLength;
				return {
					rootId,
					relativePath,
					expectedVersion,
					content: value.slice(offset, offset + contentLength),
				};
			};
			const plr1Frame = (content: Uint8Array, version: string): Uint8Array => {
				const versionBytes = encoder.encode(version);
				const frame = new Uint8Array(
					36 + versionBytes.byteLength + content.byteLength,
				);
				const view = new DataView(frame.buffer);
				frame.set([0x50, 0x4c, 0x52, 0x31], 0);
				frame[4] = 1;
				frame[5] = versionBytes.byteLength;
				view.setUint16(6, 0, false);
				view.setUint32(8, content.byteLength, false);
				view.setBigUint64(12, BigInt(content.byteLength), false);
				view.setBigUint64(20, 1_700_000_000_000n, false);
				view.setBigUint64(28, 1_699_999_000_000n, false);
				frame.set(versionBytes, 36);
				frame.set(content, 36 + versionBytes.byteLength);
				return frame;
			};
			let deleteSerial = 401;
			const nextDeleteId = (): string =>
				`00000000-0000-4000-8000-${(deleteSerial++)
					.toString()
					.padStart(12, "0")}`;
			let activeDelete:
				| {
						confirmationId: string;
						entryId: string;
						rootId: string;
						relativePath: string;
						recursive: boolean;
						phase: "prepared" | "executing";
				  }
				| undefined;

			const callbacks = new Map<
				number,
				{ callback: (payload: unknown) => void; once: boolean }
			>();
			const eventHandlers = new Map<
				number,
				{ event: string; handlerId: number }
			>();
			let nextCallbackId = 0;
			let nextEventId = 0;
			const emitUserDataChanged = (
				resource: "settings" | "keybindings",
				revision: number,
			): void => {
				for (const [eventId, registration] of eventHandlers) {
					if (registration.event !== "plain://user-data-changed") continue;
					const transformed = callbacks.get(registration.handlerId);
					transformed?.callback({
						event: registration.event,
						id: eventId,
						payload: { resource, revision },
					});
					if (transformed?.once === true) {
						callbacks.delete(registration.handlerId);
					}
				}
			};
			const emitWorkspaceWatchWake = (): number => {
				let delivered = 0;
				for (const [eventId, registration] of eventHandlers) {
					if (registration.event !== "plain://workspace-watch-wake") {
						continue;
					}
					const transformed = callbacks.get(registration.handlerId);
					if (transformed === undefined) {
						continue;
					}
					delivered += 1;
					transformed.callback({
						event: registration.event,
						id: eventId,
						payload: { workspaceId },
					});
					if (transformed.once) {
						callbacks.delete(registration.handlerId);
					}
				}
				return delivered;
			};
			const watchState = (rootId: string): WatchState => {
				let state = watchStates.get(rootId);
				if (state === undefined) {
					state = {
						nextGeneration: 1,
						pending: undefined,
						dirty: false,
						dirtyRescanRequired: false,
					};
					watchStates.set(rootId, state);
				}
				return state;
			};
			const promoteWatchPending = (rootId: string, state: WatchState): void => {
				if (state.pending !== undefined || !state.dirty) {
					return;
				}
				const generation = state.nextGeneration;
				state.pending = Object.freeze({
					rootId,
					generation,
					rescanRequired: state.dirtyRescanRequired,
				});
				state.nextGeneration = Math.min(0xffff_ffff, generation + 1);
				state.dirty = false;
				state.dirtyRescanRequired = false;
			};
			const invalidateRoot = (rootId: string): void => {
				if (!activeRoots.has(rootId)) {
					throw rootNotAuthorized();
				}
				const state = watchState(rootId);
				state.dirty = true;
				state.dirtyRescanRequired = true;
				promoteWatchPending(rootId, state);
			};
			const externalCreate = (
				rootId: string,
				name: string,
				emitWake: boolean,
			): number => {
				if (!/^[A-Za-z0-9._-]+$/u.test(name)) {
					throw new TypeError("Invalid multi-root browser test entry.");
				}
				if (typeof emitWake !== "boolean") {
					throw new TypeError("Invalid multi-root browser test wake mode.");
				}
				const root = resolveNode(rootId, "");
				if (root.kind !== "directory" || root.entries.has(name)) {
					throw entryTypeMismatch();
				}
				root.entries.set(name, file(`external:${name}\n`));
				invalidateRoot(rootId);
				externalCreateTimings.push({
					rootId,
					name,
					injectedAt: performance.now(),
				});
				return emitWake ? emitWorkspaceWatchWake() : 0;
			};

			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: typeof calls;
				__PLAIN_TEST_MULTI_ROOT_VERSION_TRANSITIONS__: typeof versionTransitions;
				__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__: typeof watchExchanges;
				__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGE_TIMINGS__: typeof watchExchangeTimings;
				__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE_TIMINGS__: typeof externalCreateTimings;
				__PLAIN_TEST_MULTI_ROOT_EMIT_WAKE__(): number;
				__PLAIN_TEST_MULTI_ROOT_WATCH_LISTENER_COUNT__(): number;
				__PLAIN_TEST_DEBUG_SESSION_IDS__(): readonly string[];
				__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE__(
					rootId: string,
					name: string,
					emitWake: boolean,
				): number;
				__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE_AFTER_NEXT_SYNC__(
					rootId: string,
					name: string,
					emitWake: boolean,
				): Promise<number>;
				__TAURI_EVENT_PLUGIN_INTERNALS__: {
					unregisterListener(): void;
				};
				__TAURI_INTERNALS__: {
					invoke(
						command: string,
						args?: Record<string, unknown> | Uint8Array,
					): Promise<unknown>;
					transformCallback(
						callback?: (payload: unknown) => void,
						once?: boolean,
					): number;
					unregisterCallback(callbackId: number): void;
				};
			};
			testWindow.__PLAIN_TEST_TAURI_CALLS__ = calls;
			testWindow.__PLAIN_TEST_MULTI_ROOT_VERSION_TRANSITIONS__ =
				versionTransitions;
			testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__ = watchExchanges;
			testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGE_TIMINGS__ =
				watchExchangeTimings;
			testWindow.__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE_TIMINGS__ =
				externalCreateTimings;
			testWindow.__PLAIN_TEST_MULTI_ROOT_EMIT_WAKE__ = emitWorkspaceWatchWake;
			testWindow.__PLAIN_TEST_MULTI_ROOT_WATCH_LISTENER_COUNT__ = () =>
				[...eventHandlers.values()].filter(
					({ event }) => event === "plain://workspace-watch-wake",
				).length;
			testWindow.__PLAIN_TEST_DEBUG_SESSION_IDS__ = () => [
				...debugSessionRoots.keys(),
			];
			testWindow.__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE__ = externalCreate;
			testWindow.__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE_AFTER_NEXT_SYNC__ = (
				rootId,
				name,
				emitWake,
			) => {
				if (deferredExternalCreate !== undefined) {
					throw new Error(
						"A multi-root browser test change is already queued.",
					);
				}
				if (!/^[A-Za-z0-9._-]+$/u.test(name)) {
					throw new TypeError("Invalid multi-root browser test entry.");
				}
				if (typeof emitWake !== "boolean") {
					throw new TypeError("Invalid multi-root browser test wake mode.");
				}
				return new Promise<number>((resolve, reject) => {
					deferredExternalCreate = Object.freeze({
						rootId,
						name,
						emitWake,
						resolve,
						reject,
					});
				});
			};
			testWindow.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
				unregisterListener() {},
			};
			testWindow.__TAURI_INTERNALS__ = {
				transformCallback(callback, once = false) {
					nextCallbackId += 1;
					if (callback !== undefined) {
						callbacks.set(nextCallbackId, { callback, once });
					}
					return nextCallbackId;
				},
				unregisterCallback(callbackId) {
					callbacks.delete(callbackId);
				},
				async invoke(command, args: Record<string, unknown> | Uint8Array = {}) {
					if (command === "workspace_write_file") {
						if (!(args instanceof Uint8Array)) {
							throw new Error("Expected one raw PLW1 multi-root frame.");
						}
						assertSupportedMutation();
						const frame = plw1Frame(args);
						calls.push({
							command,
							args: {
								rawHex: hexFromBytes(args),
								request: {
									rootId: frame.rootId,
									relativePath: frame.relativePath,
									expectedVersion: frame.expectedVersion,
								},
								contentHex: hexFromBytes(frame.content),
							},
						});
						const node = resolveNode(frame.rootId, frame.relativePath);
						if (node.kind !== "file") {
							throw entryTypeMismatch();
						}
						if (node.version !== frame.expectedVersion) {
							throw {
								code: "WORKSPACE_FILE_MODIFIED",
								message: "The workspace file changed since it was read.",
							};
						}
						node.bytes = frame.content.slice();
						node.version = nextVersion();
						return {
							status: "written",
							stat: {
								kind: "file",
								size: node.bytes.byteLength,
								mtime: 1_700_000_000_001,
								ctime: 1_699_999_000_000,
								version: node.version,
							},
						};
					}
					if (command === "backup_write") {
						if (!(args instanceof Uint8Array)) {
							throw new Error("Expected one raw PLB2 multi-root test frame.");
						}
						const frame = plb2Frame(args);
						if (!activeRoots.has(frame.rootId)) {
							throw rootNotAuthorized();
						}
						calls.push({
							command,
							args: {
								rootId: frame.rootId,
								key: frame.key,
								contentHex: hexFromBytes(frame.content),
							},
						});
						backupEntries.set(backupMapKey(frame.rootId, frame.key), {
							rootId: frame.rootId,
							key: frame.key,
							bytes: frame.content.slice(),
						});
						persistBackupEntries();
						return null;
					}
					if (args instanceof Uint8Array) {
						throw new Error(`Unexpected raw Tauri test command: ${command}`);
					}
					calls.push({ command, args: structuredClone(args) });
					switch (command) {
						case "plugin:event|listen": {
							const event = args.event;
							const handlerId = args.handler;
							if (typeof event !== "string" || typeof handlerId !== "number") {
								throw new Error("Malformed Tauri event listener request.");
							}
							nextEventId += 1;
							eventHandlers.set(nextEventId, { event, handlerId });
							return nextEventId;
						}
						case "plugin:event|unlisten": {
							const eventId = args.eventId;
							if (typeof eventId === "number") {
								eventHandlers.delete(eventId);
							}
							return undefined;
						}
						case "runtime_info":
							return {
								application: "Plain",
								ipcVersion: 1,
								runtime: "tauri",
							};
						case "user_data_read": {
							const resource = (args.request as { resource?: unknown })
								?.resource;
							const entry =
								resource === "settings" || resource === "keybindings"
									? userDataEntries.get(resource)
									: undefined;
							if (entry === undefined)
								throw new Error("Invalid user-data read.");
							return { resource, ...entry };
						}
						case "user_data_write": {
							const userRequest = args.request as {
								resource?: unknown;
								expectedRevision?: unknown;
								content?: unknown;
							};
							const resource = userRequest.resource;
							if (resource !== "settings" && resource !== "keybindings") {
								throw new Error("Invalid user-data write.");
							}
							const entry = userDataEntries.get(resource);
							if (
								entry === undefined ||
								entry.revision !== userRequest.expectedRevision ||
								typeof userRequest.content !== "string"
							) {
								throw new Error("Invalid user-data write.");
							}
							const next = {
								revision: entry.revision + 1,
								content: userRequest.content,
							};
							userDataEntries.set(resource, next);
							emitUserDataChanged(resource, next.revision);
							return { resource, ...next };
						}
						case "workspace_capabilities":
							return {
								create: mode === "supported",
								renameNoReplace: mode === "supported",
								copyMove: mode === "supported",
								delete: mode === "supported",
								trash: mode === "supported",
								versionedWrite: mode === "supported",
							};
						case "workspace_trust_state":
							return { trusted: true };
						case "debug_adapter_confirmation_state": {
							const request = (args.request ?? {}) as {
								command?: unknown;
								args?: unknown;
								transport?: unknown;
							};
							return {
								confirmed: debugAdapterConfirmations.has(
									debugAdapterConfirmationKey(request),
								),
							};
						}
						case "debug_adapter_confirmation_grant": {
							const request = (args.request ?? {}) as {
								command?: unknown;
								args?: unknown;
								transport?: unknown;
							};
							debugAdapterConfirmations.add(
								debugAdapterConfirmationKey(request),
							);
							return null;
						}
						case "debug_adapter_confirmation_revoke": {
							const request = (args.request ?? {}) as {
								command?: unknown;
								args?: unknown;
								transport?: unknown;
							};
							debugAdapterConfirmations.delete(
								debugAdapterConfirmationKey(request),
							);
							return null;
						}
						case "debug_launch":
						case "debug_attach": {
							const request = (args.request ?? {}) as {
								rootId?: unknown;
								command?: unknown;
								args?: unknown;
								transport?: unknown;
							};
							if (
								typeof request.rootId !== "string" ||
								!activeRoots.has(request.rootId)
							) {
								throw rootNotAuthorized();
							}
							if (
								!debugAdapterConfirmations.has(
									debugAdapterConfirmationKey(request),
								)
							) {
								throw debugAdapterNotConfirmed();
							}
							const sessionId = nextDebugSessionId();
							debugSessionRoots.set(sessionId, request.rootId);
							return { sessionId, capabilities: {} };
						}
						case "debug_set_breakpoints": {
							const request = (args.request ?? {}) as {
								sessionId?: unknown;
								rootId?: unknown;
								path?: unknown;
								breakpoints?: readonly {
									line: number;
								}[];
							};
							if (
								typeof request.sessionId !== "string" ||
								typeof request.rootId !== "string" ||
								!activeRoots.has(request.rootId) ||
								debugSessionRoots.get(request.sessionId) !== request.rootId
							) {
								throw debugSessionNotFound();
							}
							return {
								breakpoints: (request.breakpoints ?? []).map((entry) => ({
									verified: true,
									line: entry.line,
									id: null,
									message: null,
								})),
							};
						}
						case "debug_disconnect": {
							const request = (args.request ?? {}) as {
								sessionId?: unknown;
							};
							if (
								typeof request.sessionId !== "string" ||
								!debugSessionRoots.delete(request.sessionId)
							) {
								throw debugSessionNotFound();
							}
							return null;
						}
						case "terminal_profiles": {
							return {
								profiles: [
									{
										id: "systemDefault",
										label: "zsh (System Default)",
									},
									{ id: "zsh", label: "zsh" },
								],
								defaultProfileId: "systemDefault",
							};
						}
						case "terminal_start": {
							const request = args.request as
								| {
										rootId?: unknown;
										profileId?: unknown;
										cwd?: unknown;
										cols?: unknown;
										rows?: unknown;
								  }
								| undefined;
							if (
								typeof request?.rootId !== "string" ||
								!activeRoots.has(request.rootId) ||
								request.profileId !== "systemDefault" ||
								request.cwd !== null ||
								typeof request.cols !== "number" ||
								typeof request.rows !== "number"
							) {
								throw rootNotAuthorized();
							}
							const sessionId = nextTerminalSessionId();
							terminalSessions.add(sessionId);
							return { sessionId, shellIntegration: "injected" };
						}
						case "terminal_input_text":
						case "terminal_input_key":
						case "terminal_focus":
						case "terminal_resize":
						case "terminal_ack":
						case "terminal_scrollback": {
							terminalSessionFrom(args);
							return command === "terminal_scrollback" ? { rows: [] } : null;
						}
						case "terminal_kill": {
							terminalSessions.delete(terminalSessionFrom(args));
							return null;
						}
						case "terminal_open_external_link": {
							const request = args.request as { url?: unknown } | undefined;
							if (
								typeof request?.url !== "string" ||
								!/^https?:\/\//.test(request.url)
							) {
								throw Object.freeze({
									code: "TERMINAL_LINK_INVALID",
									message: "The requested link is not a valid http(s) URL.",
								});
							}
							return null;
						}
						// `F190` S6: this fixture has no reason to model reload/crash
						// marker persistence of its own — every scenario using it
						// predates `F190` S6 and expects an ordinary, notice-free
						// mount; `0` is that answer. The dedicated single-root
						// `installNativeIpcMock` fixture is what this slice's own
						// non-restorable-lifecycle scenarios use instead.
						case "terminal_lifecycle_marker": {
							return { nonRestorableCount: 0 };
						}
						case "git_status": {
							const selectedRootId = selectedGitRootId(args);
							return structuredClone({
								branch: gitBranchesByRoot.get(selectedRootId),
								entries: gitEntriesByRoot.get(selectedRootId) ?? [],
							});
						}
						case "git_diff_files":
							selectedGitRootId(args);
							return { entries: [] };
						case "git_show_blob": {
							const selectedRootId = selectedGitRootId(args);
							const request = args.request as
								{ rev?: string; path?: string } | undefined;
							const label =
								selectedRootId === primaryRootId ? "primary" : "secondary";
							const text = `${label}:${request?.rev ?? "unknown"}:${request?.path ?? "unknown"}\n`;
							return { content: Array.from(encoder.encode(text)) };
						}
						case "git_stage_paths": {
							const selectedRootId = selectedGitRootId(args);
							const request = args.request as { paths?: string[] } | undefined;
							const entries = gitEntriesByRoot.get(selectedRootId) ?? [];
							for (const path of request?.paths ?? []) {
								const index = entries.findIndex((entry) => entry.path === path);
								if (index < 0) {
									continue;
								}
								const entry = entries[index]!;
								if (entry.type === "untracked") {
									entries[index] = gitOrdinaryEntry(path, "A", ".");
									continue;
								}
								const worktreeStatus =
									typeof entry.worktreeStatus === "string"
										? entry.worktreeStatus
										: ".";
								entries[index] = gitOrdinaryEntry(
									path,
									worktreeStatus === "." ? "M" : worktreeStatus,
									".",
								);
							}
							return null;
						}
						case "git_unstage_paths": {
							const selectedRootId = selectedGitRootId(args);
							const request = args.request as { paths?: string[] } | undefined;
							const entries = gitEntriesByRoot.get(selectedRootId) ?? [];
							for (const path of request?.paths ?? []) {
								const index = entries.findIndex((entry) => entry.path === path);
								if (index >= 0) {
									entries[index] = gitOrdinaryEntry(path, ".", "M");
								}
							}
							return null;
						}
						case "git_blame_file":
							selectedGitRootId(args);
							return { entries: [], commits: {} };
						case "git_blame_commit_messages":
							selectedGitRootId(args);
							return { messages: {} };
						case "git_file_history":
						case "git_line_history_list":
							selectedGitRootId(args);
							return { entries: [], truncated: false };
						case "git_log_graph":
							selectedGitRootId(args);
							return { nodes: [], truncated: false };
						case "git_refs_list": {
							const selectedRootId = selectedGitRootId(args);
							return {
								entries: structuredClone(
									gitRefsByRoot.get(selectedRootId) ?? [],
								),
								truncated: false,
							};
						}
						case "git_branch_create": {
							const selectedRootId = selectedGitRootId(args);
							const request = args.request as
								{ name?: string; targetSha?: string } | undefined;
							gitRefsByRoot.get(selectedRootId)?.push({
								kind: "branch",
								fullName: `refs/heads/${request?.name ?? ""}`,
								shortName: request?.name ?? "",
								targetSha: request?.targetSha ?? "",
								isAnnotatedTag: false,
								peeledSha: null,
								upstream: null,
								isHead: false,
							});
							return null;
						}
						case "git_stash_list":
							selectedGitRootId(args);
							return { entries: [], truncated: false };
						case "git_worktree_list":
							selectedGitRootId(args);
							return { entries: [], truncated: false };
						case "workspace_snapshot":
							return snapshot();
						case "workspace_recent_list":
							return {
								revision: recentRevision,
								restoreStatus: "none",
								entries: recentEntries.map(({ entry }) => entry),
							};
						case "workspace_open_files": {
							const status = scriptedFilePicks.shift() ?? "selected";
							if (status === "cancelled") {
								return { status, snapshot: snapshot(), files: [] };
							}
							if (!activeRoots.has(primaryRootId)) {
								activeRoots.set(primaryRootId, primaryRoot);
								invalidateRoot(primaryRootId);
								revision += 1;
							}
							recordRecent();
							return {
								status,
								snapshot: snapshot(),
								files: [{ rootId: primaryRootId, relativePath: "README.md" }],
							};
						}
						case "workspace_open_recent": {
							const recentId = (
								args.request as { recentId?: unknown } | undefined
							)?.recentId;
							const index = recentEntries.findIndex(
								(candidate) => candidate.entry.recentId === recentId,
							);
							if (index < 0) {
								throw {
									code: "WORKSPACE_RECENT_NOT_FOUND",
									message:
										"The selected recent workspace is no longer available.",
								};
							}
							const selected = recentEntries[index]!;
							activeRoots.clear();
							for (const root of selected.roots) {
								activeRoots.set(root.rootId, root);
								invalidateRoot(root.rootId);
							}
							revision += 1;
							recordRecent();
							return snapshot();
						}
						case "workspace_remove_recent": {
							const recentId = (
								args.request as { recentId?: unknown } | undefined
							)?.recentId;
							const before = recentEntries.length;
							recentEntries = recentEntries.filter(
								(candidate) => candidate.entry.recentId !== recentId,
							);
							if (recentEntries.length === before) {
								throw {
									code: "WORKSPACE_RECENT_NOT_FOUND",
									message:
										"The selected recent workspace is no longer available.",
								};
							}
							recentRevision += 1;
							return null;
						}
						case "workspace_clear_recent":
							recentEntries = [];
							recentRevision += 1;
							return null;
						case "workspace_pick_roots": {
							const request = args.request as { mode?: unknown } | undefined;
							if (request?.mode === "replace") {
								if (activeRoots.size !== 0) {
									throw new Error(
										"Unexpected replace-root browser test state.",
									);
								}
								activeRoots.set(primaryRootId, primaryRoot);
								invalidateRoot(primaryRootId);
								revision += 1;
								recordRecent();
								return { status: "selected", snapshot: snapshot() };
							}
							if (request?.mode === "add") {
								if (activeRoots.size !== 1 || !activeRoots.has(primaryRootId)) {
									throw new Error("Unexpected add-root browser test state.");
								}
								activeRoots.set(secondaryRootId, secondaryRoot);
								invalidateRoot(secondaryRootId);
								revision += 1;
								recordRecent();
								return { status: "selected", snapshot: snapshot() };
							}
							throw new Error("Unexpected workspace picker mode.");
						}
						case "workspace_remove_root": {
							const request = args.request as { rootId?: unknown } | undefined;
							if (
								typeof request?.rootId !== "string" ||
								!activeRoots.delete(request.rootId)
							) {
								throw rootNotAuthorized();
							}
							watchStates.delete(request.rootId);
							if (activeDelete?.rootId === request.rootId) {
								activeDelete = undefined;
							}
							revision += 1;
							recordRecent();
							return snapshot();
						}
						case "workspace_watch_sync": {
							const request = args.request as
								{ roots?: readonly unknown[] } | null | undefined;
							if (
								typeof request !== "object" ||
								request === null ||
								Array.isArray(request) ||
								Reflect.ownKeys(request).length !== 1 ||
								!Object.hasOwn(request, "roots") ||
								!Array.isArray(request.roots) ||
								request.roots.length < 1 ||
								request.roots.length > 256
							) {
								throw new TypeError("Invalid workspace watch test request.");
							}
							const uniqueRootIds = new Set<string>();
							const requestRoots = request.roots.map((candidate) => {
								if (
									typeof candidate !== "object" ||
									candidate === null ||
									Array.isArray(candidate)
								) {
									throw new TypeError("Invalid workspace watch test root.");
								}
								const root = candidate as Record<string, unknown>;
								const rootKeys = Reflect.ownKeys(root);
								if (
									rootKeys.length !== 2 ||
									!Object.hasOwn(root, "rootId") ||
									!Object.hasOwn(root, "acknowledgedGeneration") ||
									typeof root.rootId !== "string" ||
									!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
										root.rootId,
									) ||
									(root.acknowledgedGeneration !== null &&
										(typeof root.acknowledgedGeneration !== "number" ||
											!Number.isSafeInteger(root.acknowledgedGeneration) ||
											root.acknowledgedGeneration < 1 ||
											root.acknowledgedGeneration > 0xffff_ffff)) ||
									uniqueRootIds.has(root.rootId)
								) {
									throw new TypeError("Invalid workspace watch test root.");
								}
								uniqueRootIds.add(root.rootId);
								return {
									rootId: root.rootId,
									acknowledgedGeneration: root.acknowledgedGeneration,
								} satisfies WatchRootRequest;
							});
							const pendingRoots: WatchPendingRoot[] = [];
							for (const root of requestRoots) {
								if (!activeRoots.has(root.rootId)) {
									continue;
								}
								const state = watchState(root.rootId);
								if (
									root.acknowledgedGeneration === null &&
									state.pending === undefined
								) {
									state.dirty = true;
									state.dirtyRescanRequired = true;
								} else if (
									state.pending?.generation === root.acknowledgedGeneration
								) {
									if (root.acknowledgedGeneration === 0xffff_ffff) {
										state.pending = Object.freeze({
											...state.pending,
											rescanRequired: true,
										});
									} else {
										state.pending = undefined;
									}
								}
								promoteWatchPending(root.rootId, state);
								if (state.pending !== undefined) {
									pendingRoots.push(state.pending);
								}
							}
							const result = { workspaceId, roots: pendingRoots };
							watchExchanges.push({
								callIndex: calls.length - 1,
								request: { roots: requestRoots },
								result: {
									workspaceId,
									roots: pendingRoots.map((root) => ({ ...root })),
								},
							});
							watchExchangeTimings.push({
								callIndex: calls.length - 1,
								observedAt: performance.now(),
							});
							const deferred = deferredExternalCreate;
							if (deferred !== undefined) {
								deferredExternalCreate = undefined;
								try {
									deferred.resolve(
										externalCreate(
											deferred.rootId,
											deferred.name,
											deferred.emitWake,
										),
									);
								} catch (error) {
									deferred.reject(error);
								}
							}
							return result;
						}
						case "workspace_create_file":
						case "workspace_create_directory": {
							assertSupportedMutation();
							const request = args.request as
								{ rootId?: unknown; relativePath?: unknown } | undefined;
							if (
								request === undefined ||
								Object.keys(request).length !== 2 ||
								typeof request.rootId !== "string" ||
								typeof request.relativePath !== "string"
							) {
								throw entryTypeMismatch();
							}
							const target = resolveParent(
								request.rootId,
								request.relativePath,
							);
							if (target.parent.entries.has(target.name)) {
								throw entryAlreadyExists();
							}
							const kind =
								command === "workspace_create_file" ? "file" : "directory";
							target.parent.entries.set(
								target.name,
								kind === "file" ? file("") : directory([]),
							);
							return {
								kind,
								size: 0,
								mtime: 0,
								ctime: 0,
								version: null,
							};
						}
						case "workspace_copy": {
							assertSupportedMutation();
							const request = args.request as
								| {
										sourceRootId?: unknown;
										sourcePath?: unknown;
										targetRootId?: unknown;
										targetPath?: unknown;
								  }
								| undefined;
							if (
								request === undefined ||
								Object.keys(request).length !== 4 ||
								typeof request.sourceRootId !== "string" ||
								typeof request.sourcePath !== "string" ||
								typeof request.targetRootId !== "string" ||
								typeof request.targetPath !== "string"
							) {
								throw entryTypeMismatch();
							}
							const source = resolveNode(
								request.sourceRootId,
								request.sourcePath,
							);
							if (source.kind !== "file") {
								throw entryTypeMismatch();
							}
							const target = resolveParent(
								request.targetRootId,
								request.targetPath,
							);
							if (target.parent.entries.has(target.name)) {
								throw entryAlreadyExists();
							}
							const copiedNode: MockFile = {
								kind: "file",
								bytes: source.bytes.slice(),
								version: nextVersion(),
							};
							target.parent.entries.set(target.name, copiedNode);
							versionTransitions.push({
								command: "workspace_copy",
								sourceRootId: request.sourceRootId,
								sourcePath: request.sourcePath,
								sourceVersion: source.version,
								targetRootId: request.targetRootId,
								targetPath: request.targetPath,
								targetVersion: copiedNode.version,
							});
							return null;
						}
						case "workspace_rename": {
							assertSupportedMutation();
							const request = args.request as
								| {
										rootId?: unknown;
										sourcePath?: unknown;
										targetPath?: unknown;
								  }
								| undefined;
							if (
								request === undefined ||
								Object.keys(request).length !== 3 ||
								typeof request.rootId !== "string" ||
								typeof request.sourcePath !== "string" ||
								typeof request.targetPath !== "string"
							) {
								throw entryTypeMismatch();
							}
							const source = resolveParent(request.rootId, request.sourcePath);
							const target = resolveParent(request.rootId, request.targetPath);
							const node = source.parent.entries.get(source.name);
							if (node === undefined) {
								throw entryNotFound();
							}
							if (target.parent.entries.has(target.name)) {
								throw entryAlreadyExists();
							}
							target.parent.entries.set(target.name, rebindNodeVersions(node));
							source.parent.entries.delete(source.name);
							return null;
						}
						case "workspace_move": {
							assertSupportedMutation();
							const request = args.request as
								| {
										sourceRootId?: unknown;
										sourcePath?: unknown;
										targetRootId?: unknown;
										targetPath?: unknown;
								  }
								| undefined;
							if (
								request === undefined ||
								Object.keys(request).length !== 4 ||
								typeof request.sourceRootId !== "string" ||
								typeof request.sourcePath !== "string" ||
								typeof request.targetRootId !== "string" ||
								typeof request.targetPath !== "string" ||
								request.sourceRootId === request.targetRootId
							) {
								throw entryTypeMismatch();
							}
							const source = resolveParent(
								request.sourceRootId,
								request.sourcePath,
							);
							const target = resolveParent(
								request.targetRootId,
								request.targetPath,
							);
							const node = source.parent.entries.get(source.name);
							if (node === undefined) {
								throw entryNotFound();
							}
							if (target.parent.entries.has(target.name)) {
								throw entryAlreadyExists();
							}
							const plannedIncomplete = moveIncompletePlan[0];
							if (
								plannedIncomplete === "moveRetained" &&
								(request.sourceRootId !== secondaryRootId ||
									request.sourcePath !== "move-source.txt" ||
									request.targetRootId !== primaryRootId ||
									request.targetPath !== "src/move-source.txt")
							) {
								throw new Error(
									"Unexpected retained move browser test request.",
								);
							}
							if (
								plannedIncomplete === "movePartial" &&
								(request.sourceRootId !== secondaryRootId ||
									request.sourcePath !== "move-partial" ||
									request.targetRootId !== primaryRootId ||
									request.targetPath !== "src/move-partial")
							) {
								throw new Error(
									"Unexpected partial move browser test request.",
								);
							}
							const reboundNode = rebindNodeVersions(node);
							target.parent.entries.set(target.name, reboundNode);
							if (node.kind === "file" && reboundNode.kind === "file") {
								versionTransitions.push({
									command: "workspace_move",
									sourceRootId: request.sourceRootId,
									sourcePath: request.sourcePath,
									sourceVersion: node.version,
									targetRootId: request.targetRootId,
									targetPath: request.targetPath,
									targetVersion: reboundNode.version,
								});
							}
							if (plannedIncomplete === "moveRetained") {
								moveIncompletePlan.shift();
								return {
									status: "targetPublishedSourceRetained",
									reason: "deleteFailed",
								};
							}
							if (plannedIncomplete === "movePartial") {
								if (node.kind !== "directory") {
									throw entryTypeMismatch();
								}
								const removedEntries = node.entries.delete("removed.txt")
									? 1
									: 0;
								if (removedEntries !== 1 || !node.entries.has("kept.txt")) {
									throw new Error(
										"Invalid partial move browser test source tree.",
									);
								}
								moveIncompletePlan.shift();
								return {
									status: "targetPublishedSourcePartiallyDeleted",
									reason: "deleteFailed",
									removedEntries,
								};
							}
							source.parent.entries.delete(source.name);
							return { status: "moved" };
						}
						case "workspace_prepare_delete": {
							assertSupportedMutation();
							const request = args.request as
								| {
										entries?: readonly {
											rootId?: unknown;
											relativePath?: unknown;
											recursive?: unknown;
										}[];
								  }
								| undefined;
							const entry = request?.entries?.[0];
							if (
								request === undefined ||
								Object.keys(request).length !== 1 ||
								request.entries?.length !== 1 ||
								entry === undefined ||
								Object.keys(entry).length !== 3 ||
								typeof entry.rootId !== "string" ||
								typeof entry.relativePath !== "string" ||
								typeof entry.recursive !== "boolean"
							) {
								throw invalidDeletePlan();
							}
							const node = resolveNode(entry.rootId, entry.relativePath);
							const confirmationId = nextDeleteId();
							const entryId = nextDeleteId();
							activeDelete = {
								confirmationId,
								entryId,
								rootId: entry.rootId,
								relativePath: entry.relativePath,
								recursive: entry.recursive,
								phase: "prepared",
							};
							return {
								confirmationId,
								entries: [
									{
										entryId,
										kind: node.kind,
										descendantEntries: descendantEntries(node),
									},
								],
							};
						}
						case "workspace_cancel_delete": {
							assertSupportedMutation();
							const request = args.request as
								{ confirmationId?: unknown } | undefined;
							if (
								typeof request?.confirmationId !== "string" ||
								request.confirmationId !== activeDelete?.confirmationId
							) {
								throw invalidDeletePlan();
							}
							activeDelete = undefined;
							return null;
						}
						case "workspace_begin_delete": {
							assertSupportedMutation();
							const request = args.request as
								{ confirmationId?: unknown } | undefined;
							if (
								activeDelete === undefined ||
								activeDelete.phase !== "prepared" ||
								request?.confirmationId !== activeDelete.confirmationId
							) {
								throw invalidDeletePlan();
							}
							activeDelete.phase = "executing";
							return null;
						}
						case "workspace_commit_delete_entry": {
							assertSupportedMutation();
							const request = args.request as
								| {
										confirmationId?: unknown;
										entryId?: unknown;
										rootId?: unknown;
										relativePath?: unknown;
										recursive?: unknown;
								  }
								| undefined;
							if (
								activeDelete === undefined ||
								activeDelete.phase !== "executing" ||
								request?.confirmationId !== activeDelete.confirmationId ||
								request.entryId !== activeDelete.entryId ||
								request.rootId !== activeDelete.rootId ||
								request.relativePath !== activeDelete.relativePath ||
								request.recursive !== activeDelete.recursive
							) {
								throw invalidDeletePlan();
							}
							const plannedDeleteIncomplete = deleteIncompletePlan[0];
							if (
								plannedDeleteIncomplete === "deleteRetained" &&
								(activeDelete.rootId !== primaryRootId ||
									activeDelete.relativePath !== "delete-retained.txt")
							) {
								throw new Error(
									"Unexpected retained delete browser test request.",
								);
							}
							if (
								plannedDeleteIncomplete === "deletePartial" &&
								(activeDelete.rootId !== secondaryRootId ||
									activeDelete.relativePath !== "delete-partial")
							) {
								throw new Error(
									"Unexpected partial delete browser test request.",
								);
							}
							const target = resolveParent(
								activeDelete.rootId,
								activeDelete.relativePath,
							);
							if (plannedDeleteIncomplete === "deleteRetained") {
								deleteIncompletePlan.shift();
								activeDelete = undefined;
								return { status: "entryRetained", reason: "deleteFailed" };
							}
							if (plannedDeleteIncomplete === "deletePartial") {
								const node = target.parent.entries.get(target.name);
								if (node?.kind !== "directory") {
									throw entryTypeMismatch();
								}
								const removedEntries = node.entries.delete("removed.txt")
									? 1
									: 0;
								if (removedEntries !== 1 || !node.entries.has("kept.txt")) {
									throw new Error(
										"Invalid partial delete browser test target tree.",
									);
								}
								deleteIncompletePlan.shift();
								activeDelete = undefined;
								return {
									status: "entryPartiallyDeleted",
									reason: "deleteFailed",
									removedEntries,
								};
							}
							if (!target.parent.entries.delete(target.name)) {
								throw entryNotFound();
							}
							activeDelete = undefined;
							return { status: "deleted" };
						}
						case "workspace_search_files": {
							const request = args.request as
								| {
										roots?: unknown;
										filePattern?: unknown;
										excludeGlobs?: unknown;
										maxResults?: unknown;
								  }
								| undefined;
							if (
								request === undefined ||
								!Array.isArray(request.roots) ||
								!request.roots.every((root) => typeof root === "string") ||
								typeof request.filePattern !== "string" ||
								!Array.isArray(request.excludeGlobs) ||
								!request.excludeGlobs.every(
									(glob) => typeof glob === "string",
								) ||
								typeof request.maxResults !== "number"
							) {
								throw new TypeError("Invalid multi-root file search request.");
							}
							return searchFiles({
								roots: request.roots as string[],
								filePattern: request.filePattern,
								excludeGlobs: request.excludeGlobs as string[],
								maxResults: request.maxResults,
							});
						}
						case "workspace_search_text_start": {
							const request = args.request as
								| {
										roots?: unknown;
										pattern?: unknown;
										isRegExp?: unknown;
										isCaseSensitive?: unknown;
										isWordMatch?: unknown;
										excludeGlobs?: unknown;
										maxResults?: unknown;
										maxFileSize?: unknown;
								  }
								| undefined;
							if (
								request === undefined ||
								!Array.isArray(request.roots) ||
								!request.roots.every((root) => typeof root === "string") ||
								typeof request.pattern !== "string" ||
								typeof request.isRegExp !== "boolean" ||
								typeof request.isCaseSensitive !== "boolean" ||
								typeof request.isWordMatch !== "boolean" ||
								!Array.isArray(request.excludeGlobs) ||
								!request.excludeGlobs.every(
									(glob) => typeof glob === "string",
								) ||
								typeof request.maxResults !== "number" ||
								(request.maxFileSize !== null &&
									typeof request.maxFileSize !== "number")
							) {
								throw new TypeError("Invalid multi-root text search request.");
							}
							const result = searchText({
								roots: request.roots as string[],
								pattern: request.pattern,
								isRegExp: request.isRegExp,
								isCaseSensitive: request.isCaseSensitive,
								isWordMatch: request.isWordMatch,
								excludeGlobs: request.excludeGlobs as string[],
								maxResults: request.maxResults,
								maxFileSize: request.maxFileSize,
							});
							const searchId = nextTextSearchId();
							activeTextSearch = {
								searchId,
								batches: result.batches,
								cursor: 0,
								limitHit: result.limitHit,
							};
							return { searchId };
						}
						case "workspace_search_text_poll": {
							const request = args.request as
								{ searchId?: unknown; cursor?: unknown } | undefined;
							if (
								activeTextSearch === undefined ||
								request?.searchId !== activeTextSearch.searchId ||
								request.cursor !== activeTextSearch.cursor
							) {
								throw new TypeError("Invalid multi-root text search poll.");
							}
							const batches = activeTextSearch.batches.splice(0);
							activeTextSearch.cursor += batches.length;
							return {
								batches,
								nextCursor: activeTextSearch.cursor,
								done: true,
								limitHit: activeTextSearch.limitHit,
								skipped: { binary: 0, oversize: 0 },
							};
						}
						case "workspace_search_text_cancel": {
							const request = args.request as
								{ searchId?: unknown } | undefined;
							if (request?.searchId !== activeTextSearch?.searchId) {
								throw new TypeError("Invalid multi-root text search cancel.");
							}
							activeTextSearch = undefined;
							return null;
						}
						case "workspace_stat":
						case "workspace_read_dir":
						case "workspace_read_file": {
							const request = args.request as
								{ rootId?: unknown; relativePath?: unknown } | undefined;
							if (
								typeof request?.rootId !== "string" ||
								typeof request.relativePath !== "string"
							) {
								throw new TypeError("Invalid workspace entry test request.");
							}
							const node = resolveNode(request.rootId, request.relativePath);
							if (command === "workspace_stat") {
								return {
									kind: node.kind,
									size: node.kind === "file" ? node.bytes.byteLength : 0,
									mtime: 1_700_000_000_000,
									ctime: 1_699_999_000_000,
									version: node.kind === "file" ? node.version : null,
								};
							}
							if (command === "workspace_read_dir") {
								if (node.kind !== "directory") {
									throw entryTypeMismatch();
								}
								return {
									entries: [...node.entries]
										.map(([name, entry]) => ({ name, kind: entry.kind }))
										.sort((left, right) =>
											left.name < right.name
												? -1
												: left.name > right.name
													? 1
													: 0,
										),
								};
							}
							if (node.kind !== "file") {
								throw entryTypeMismatch();
							}
							return plr1Frame(node.bytes, node.version).buffer;
						}
						case "backup_read_all":
							return encodeBackupReadAllFrame().buffer;
						case "backup_discard": {
							const discard = args.request as
								{ rootId?: string; key?: string } | undefined;
							const key = discard?.key;
							if (
								typeof discard?.rootId !== "string" ||
								!activeRoots.has(discard.rootId) ||
								typeof key !== "string"
							) {
								throw new Error("Malformed backup_discard test request.");
							}
							backupEntries.delete(backupMapKey(discard.rootId, key));
							persistBackupEntries();
							return null;
						}
						case "backup_discard_all":
							for (const [mapKey, entry] of backupEntries) {
								if (activeRoots.has(entry.rootId)) {
									backupEntries.delete(mapKey);
								}
							}
							persistBackupEntries();
							return null;
						default:
							throw new Error(
								`Unexpected Tauri multi-root test command: ${command}`,
							);
					}
				},
			};
		},
		{
			mode,
			moveIncompleteScenarios,
			deleteIncompleteScenarios,
			workspaceId: nativeWorkspaceId,
			primaryRootId: nativeRootId,
			secondaryRootId: nativeSecondaryRootId,
			persistBackupsForTest,
			workspaceFilePicks,
		},
	);
}

async function installCapabilityFailureIpcMock(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const calls: Array<{
			command: string;
			args: Record<string, unknown>;
		}> = [];
		let nextCallbackId = 0;
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: typeof calls;
			__TAURI_EVENT_PLUGIN_INTERNALS__: {
				unregisterListener(): void;
			};
			__TAURI_INTERNALS__: {
				invoke(
					command: string,
					args?: Record<string, unknown>,
				): Promise<unknown>;
				transformCallback(): number;
				unregisterCallback(): void;
			};
		};
		testWindow.__PLAIN_TEST_TAURI_CALLS__ = calls;
		testWindow.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
			unregisterListener() {},
		};
		testWindow.__TAURI_INTERNALS__ = {
			transformCallback() {
				nextCallbackId += 1;
				return nextCallbackId;
			},
			unregisterCallback() {},
			async invoke(command, args = {}) {
				calls.push({ command, args });
				if (command === "workspace_capabilities") {
					throw {
						code: "CAPABILITY_UNAVAILABLE",
						message: "Workspace capabilities are unavailable.",
					};
				}
				throw new Error(`Unexpected Tauri test command: ${command}`);
			},
		};
	});
}

async function executePaletteCommand(
	page: Page,
	query: string,
	label: string,
): Promise<void> {
	await page.keyboard.press("ControlOrMeta+Shift+P");
	const palette = page.locator(".quick-input-widget");
	await expect(palette).toBeVisible();
	await palette.locator("input").pressSequentially(query);

	const command = palette.getByText(label, { exact: true });
	await expect(command).toHaveCount(1);
	await command.click();
	await expect(palette).toBeHidden();
}

/**
 * `F210` S4: identical to {@link executePaletteCommand} except it does *not*
 * assert the command palette itself becomes hidden after invocation — for a
 * command whose own async continuation immediately opens a *different*
 * `IQuickInputService.pick` (this domain's own "Plain: Step Into Target…",
 * once its `debugStepInTargets` fetch resolves), the follow-up picker reuses
 * the exact same `.quick-input-widget` CSS class the command palette itself
 * used, and — since the mock's fetch resolves same-tick, with no real
 * network delay to separate the two — can already be showing again before
 * `executePaletteCommand`'s own `toBeHidden()` assertion's polling window
 * ever observes a truly-hidden state, an intermittent race that would
 * otherwise fail this class of test. Every caller of this variant must
 * assert its own specific follow-up UI state itself (a picker's own
 * `placeholder`, a specific notification toast) rather than relying on this
 * function for that.
 */
async function executePaletteCommandThatMayReopenAQuickInput(
	page: Page,
	query: string,
	label: string,
): Promise<void> {
	await page.keyboard.press("ControlOrMeta+Shift+P");
	const palette = page.locator(".quick-input-widget");
	await expect(palette).toBeVisible();
	await palette.locator("input").pressSequentially(query);

	const command = palette.getByText(label, { exact: true });
	await expect(command).toHaveCount(1);
	await command.click();
}

async function installUntitledNativeIpcMock(
	page: Page,
	extraFiles: Readonly<Record<string, string>>,
	fixture: TestUntitledFixture,
): Promise<void> {
	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"supported",
		extraFiles,
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		false,
		{},
		{},
		{},
		fixture,
	);
}

async function installTrashNativeIpcMock(
	page: Page,
	outcomes: readonly TestWorkspaceTrashOutcome[],
	beginFailures = 0,
): Promise<void> {
	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"supported",
		{
			"trash-cancel.txt": "cancel stays in workspace\n",
			"trash-changed.txt": "changed stays in workspace\n",
			"trash-retained.txt": "retained stays in workspace\n",
			"trash-success.txt": "success moves to Trash\n",
		},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		false,
		{},
		{},
		{},
		{},
		outcomes,
		beginFailures,
	);
}

/** `F220` S4 — `NotificationsToasts.MAX_NOTIFICATIONS` (the vendored
 * `notificationsToasts.js`'s own real constant) caps simultaneously visible
 * toasts at 3; a 4th queues invisibly (still reachable from the Notification
 * Center, but absent from `.notifications-toasts .notification-toast`) until
 * an existing one is cleared. Several remote-lifecycle scenarios legitimately
 * accumulate 3 lingering toasts (connect/disconnect/actionable-lost-
 * connection) before the specific one a test cares about next would arrive —
 * this clears every currently-visible toast first so that one is guaranteed
 * a slot.
 *
 * Deliberately the real "Notifications: Clear All Notifications" command
 * (`notifications.clearAll`, vendored `notificationsCommands.js`,
 * `center.clearAll()`) rather than clicking each toast's own "Clear
 * Notification" button in a loop: the per-toast close button lives inside a
 * `monaco-list` row that gets torn down and recreated the moment an earlier
 * toast in the stack closes (the next queued notification is promoted into
 * its place), and closing them one at a time raced that recreation — the
 * freshly-promoted row's close button intermittently measured a `0x0`
 * bounding box for the entire duration of a click's actionability wait,
 * hanging until timeout (`force: true` doesn't help either — a target with
 * no box has no point to click). `notifications.clearAll` clears the model
 * directly, sidestepping that per-row DOM race entirely. */
async function clearAllToasts(page: Page): Promise<void> {
	const toasts = page.locator(".notifications-toasts .notification-toast");
	if ((await toasts.count()) === 0) {
		return;
	}
	await executePaletteCommand(
		page,
		"Clear All Notifications",
		"Notifications: Clear All Notifications",
	);
	await expect(toasts).toHaveCount(0);
}

async function nativeInvocations(
	page: Page,
	command: string,
): Promise<TestTauriInvocation[]> {
	return page.evaluate((expectedCommand) => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
			({ command }) => command === expectedCommand,
		);
	}, command);
}

async function createDirtyUntitled(
	page: Page,
	content: string,
): Promise<Locator> {
	await page.keyboard.press("ControlOrMeta+N");
	const activeTab = page.locator(".tabs-container .tab.active");
	await expect(activeTab).toContainText(/Untitled-[0-9]+/);
	await page.locator(".monaco-editor .view-lines").last().click();
	await page.keyboard.insertText(content);
	await expect(activeTab).toHaveClass(/dirty/);
	return activeTab;
}

async function expectPaletteCommandHidden(
	page: Page,
	query: string,
	label: string,
): Promise<void> {
	await page.keyboard.press("ControlOrMeta+Shift+P");
	const palette = page.locator(".quick-input-widget");
	await expect(palette).toBeVisible();
	await palette.locator("input").pressSequentially(query);
	await expect(palette.getByText(label, { exact: true })).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(palette).toBeHidden();
}

async function expectPaletteTitleHidden(
	page: Page,
	query: string,
	title: string,
): Promise<void> {
	await page.keyboard.press("ControlOrMeta+Shift+P");
	const palette = page.locator(".quick-input-widget");
	await expect(palette).toBeVisible();
	await palette.locator("input").pressSequentially(query);
	await expect(
		palette
			.locator(".quick-input-list .monaco-list-row")
			.filter({ hasText: title }),
	).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(palette).toBeHidden();
}

async function removeWorkspaceRootViaPalette(
	page: Page,
	rootLabel: string,
): Promise<void> {
	await page.keyboard.press("ControlOrMeta+Shift+P");
	const palette = page.locator(".quick-input-widget");
	await expect(palette).toBeVisible();
	await palette
		.locator("input")
		.pressSequentially("Remove Folder from Workspace");
	const command = palette.getByText(
		"Workspaces: Remove Folder from Workspace...",
		{ exact: true },
	);
	await expect(command).toHaveCount(1);
	await command.click();
	await expect(palette.locator("input")).toHaveAttribute(
		"placeholder",
		"Select workspace folder",
	);
	const root = palette.getByText(rootLabel, { exact: true });
	await expect(root).toHaveCount(1);
	await root.click();
	await expect(palette).toBeHidden();
}

async function openNativeWorkspaceExplorer(page: Page): Promise<Locator> {
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);
	await executePaletteCommand(page, "Open Folder", "File: Open Folder...");
	const explorer = page.getByRole("tree", { name: "Files Explorer" });
	// `F220` S4: a caller that invokes this helper more than once within the
	// same test (e.g. `launchDebugSessionThroughBothDialogs`, itself called
	// repeatedly by some tests) can now legitimately land here with the
	// workbench's own real cold-start-restore already having reopened the
	// same workspace before this very `page.goto()` call's own "File: Open
	// Folder..." above ever ran — the prior call's own "Open Folder"
	// recorded a Recent entry into this fixture's `sessionStorage`, and a
	// fresh `addInitScript` closure's `workspace_snapshot` restores from it
	// on its very first call, exactly like the real backend's own
	// `should_restore_last_workspace` always attempts. Explorer is then
	// already the open, active view by the time this line runs, and
	// clicking its already-active activity-bar tab again would only toggle
	// the sidebar shut — mirrors the existing reload-and-reauthorize test's
	// own identical `if ((await explorer.count()) === 0) { … }` guard.
	if ((await explorer.count()) === 0) {
		await page.getByRole("tab", { name: /^Explorer / }).click();
	}
	await expect(explorer).toBeVisible();
	return explorer;
}

async function waitForMultiRootWatchBaseline(page: Page): Promise<number> {
	let watermark = -1;
	await expect
		.poll(
			async () => {
				watermark = await page.evaluate(
					({ primaryRootId, secondaryRootId, workspaceId }) => {
						const testWindow = window as unknown as Window & {
							__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__: TestWorkspaceWatchExchange[];
						};
						const index =
							testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__.findIndex(
								({ request, result }) =>
									request.roots.length === 2 &&
									request.roots[0]?.rootId === primaryRootId &&
									request.roots[0].acknowledgedGeneration === 1 &&
									request.roots[1]?.rootId === secondaryRootId &&
									request.roots[1].acknowledgedGeneration === 1 &&
									result.workspaceId === workspaceId &&
									result.roots.length === 0,
							);
						return index + 1;
					},
					{
						primaryRootId: nativeRootId,
						secondaryRootId: nativeSecondaryRootId,
						workspaceId: nativeWorkspaceId,
					},
				);
				return watermark;
			},
			{
				message:
					"both workspace roots should reach generation-one acknowledgement",
				timeout: 5_000,
			},
		)
		.toBeGreaterThan(0);
	return watermark;
}

async function waitForMultiRootWatchTransition(
	page: Page,
	start: number,
	beforeAcknowledgements: TestMultiRootWatchAcknowledgements,
	targetRootId: string,
	generation: number,
	afterAcknowledgements: TestMultiRootWatchAcknowledgements,
	timeout: number,
): Promise<number> {
	let watermark = -1;
	await expect
		.poll(
			async () => {
				watermark = await page.evaluate(
					({
						afterAcknowledgements,
						beforeAcknowledgements,
						generation,
						primaryRootId,
						secondaryRootId,
						start,
						targetRootId,
						workspaceId,
					}) => {
						const testWindow = window as unknown as Window & {
							__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__: TestWorkspaceWatchExchange[];
						};
						const exchanges =
							testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__;
						const matchesRequest = (
							exchange: TestWorkspaceWatchExchange,
							acknowledgements: TestMultiRootWatchAcknowledgements,
						): boolean =>
							exchange.request.roots.length === 2 &&
							exchange.request.roots[0]?.rootId === primaryRootId &&
							exchange.request.roots[0].acknowledgedGeneration ===
								acknowledgements[0] &&
							exchange.request.roots[1]?.rootId === secondaryRootId &&
							exchange.request.roots[1].acknowledgedGeneration ===
								acknowledgements[1];
						let pendingIndex = -1;
						for (let index = start; index < exchanges.length; index += 1) {
							const exchange = exchanges[index];
							if (
								exchange === undefined ||
								exchange.result.workspaceId !== workspaceId
							) {
								continue;
							}
							if (
								pendingIndex < 0 &&
								matchesRequest(exchange, beforeAcknowledgements) &&
								exchange.result.roots.length === 1 &&
								exchange.result.roots[0]?.rootId === targetRootId &&
								exchange.result.roots[0].generation === generation &&
								exchange.result.roots[0].rescanRequired
							) {
								pendingIndex = index;
								continue;
							}
							if (
								pendingIndex >= 0 &&
								index > pendingIndex &&
								matchesRequest(exchange, afterAcknowledgements) &&
								exchange.result.roots.length === 0
							) {
								return index + 1;
							}
						}
						return -1;
					},
					{
						afterAcknowledgements,
						beforeAcknowledgements,
						generation,
						primaryRootId: nativeRootId,
						secondaryRootId: nativeSecondaryRootId,
						start,
						targetRootId,
						workspaceId: nativeWorkspaceId,
					},
				);
				return watermark;
			},
			{
				message: `workspace watcher should acknowledge ${targetRootId} generation ${generation}`,
				timeout,
			},
		)
		.toBeGreaterThan(0);
	return watermark;
}

async function explorerContextAction(
	page: Page,
	item: Locator,
	label: string,
): Promise<Locator> {
	await item.click({ button: "right" });
	const action = page
		.getByRole("menuitem")
		.filter({ has: page.getByText(label, { exact: true }) })
		.last();
	await expect(action).toBeVisible();
	return action;
}

async function activateExplorerContextAction(
	page: Page,
	item: Locator,
	label: string,
): Promise<void> {
	const action = await explorerContextAction(page, item, label);
	// The fixed Workbench menu delays its mouse-up listener. Hover selects the
	// real menu row and Enter exercises the same action without a timed sleep.
	await action.hover();
	await page.keyboard.press("Enter");
	await expect(page.locator(".context-view")).toBeHidden();
}

async function finishExplorerNameInput(
	page: Page,
	name: string,
): Promise<void> {
	const input = page.getByRole("textbox", {
		name: "Type file name. Press Enter to confirm or Escape to cancel.",
		exact: true,
	});
	await expect(input).toBeVisible();
	await input.fill(name);
	await input.press("Enter");
}

async function browserRunsOnMacOS(page: Page): Promise<boolean> {
	return page.evaluate(() => navigator.platform.startsWith("Mac"));
}

async function pressExplorerRenameKey(page: Page): Promise<void> {
	await page.keyboard.press((await browserRunsOnMacOS(page)) ? "Enter" : "F2");
}

async function pressExplorerPermanentDeleteKey(page: Page): Promise<void> {
	await page.keyboard.press(
		(await browserRunsOnMacOS(page)) ? "Meta+Alt+Backspace" : "Shift+Delete",
	);
}

async function pressExplorerTrashKey(page: Page): Promise<void> {
	await page.keyboard.press(
		(await browserRunsOnMacOS(page)) ? "Meta+Backspace" : "Delete",
	);
}

const nativeMutationCommands = [
	"workspace_create_file",
	"workspace_create_directory",
	"workspace_rename",
	"workspace_copy",
	"workspace_move",
	"workspace_prepare_delete",
	"workspace_cancel_delete",
	"workspace_begin_delete",
	"workspace_commit_delete_entry",
	"workspace_write_file",
	"workspace_remove_root",
] as const;

const nativeDeleteCommands = [
	"workspace_prepare_delete",
	"workspace_cancel_delete",
	"workspace_begin_delete",
	"workspace_commit_delete_entry",
] as const;

const nativeTrashCommands = [
	"workspace_prepare_trash",
	"workspace_cancel_trash",
	"workspace_begin_trash",
	"workspace_commit_trash_entry",
] as const;

test("fails closed before workspace bootstrap when capabilities are unavailable", async ({
	page,
}) => {
	await installCapabilityFailureIpcMock(page);
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"error",
	);
	const workspaceInvocations = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(({ command }) =>
			command.startsWith("workspace_"),
		);
	});
	expect(workspaceInvocations).toEqual([
		{ command: "workspace_capabilities", args: { request: {} } },
	]);
});

test("adds a second workspace root and replaces it through Workbench actions", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});

	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);
	await executePaletteCommand(page, "Open Folder", "File: Open Folder...");
	await page.getByRole("tab", { name: /^Explorer / }).click();

	const explorer = page.getByRole("tree", { name: "Files Explorer" });
	await expect(explorer).toBeVisible();
	const primaryRoot = explorer.getByRole("treeitem", {
		name: "plain-workspace",
		exact: true,
	});
	const secondaryRoot = explorer.getByRole("treeitem", {
		name: "plain-library",
		exact: true,
	});
	await expect(primaryRoot).toHaveCount(1);
	await expect(secondaryRoot).toHaveCount(0);

	await executePaletteCommand(
		page,
		"Add Folder to Workspace",
		"Workspaces: Add Folder to Workspace...",
	);
	await expect(primaryRoot).toHaveCount(1);
	await expect(secondaryRoot).toHaveCount(1);

	await executePaletteCommand(page, "Open Folder", "File: Open Folder...");
	await expect(primaryRoot).toHaveCount(1);
	await expect(secondaryRoot).toHaveCount(0);
	await expect(
		page.locator(".notifications-toasts .notification-toast"),
	).toHaveCount(0);
	expect(errors).toEqual([]);
});

test("opens a file with parent-root adoption and manages path-free recent workspaces", async ({
	page,
}) => {
	const errors: string[] = [];
	const nativeDialogs: string[] = [];
	await installMultiRootNativeIpcMock(page, "readonly", [], [], false, [
		"cancelled",
		"selected",
	]);
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});

	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	await executePaletteCommand(page, "Open File", "File: Open File...");
	await expect(
		page.getByRole("tab", { name: /^README\.md(?:,.*)?$/ }),
	).toHaveCount(0);
	let openFileCalls = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
			({ command }) => command === "workspace_open_files",
		);
	});
	expect(openFileCalls).toEqual([
		{ command: "workspace_open_files", args: { request: {} } },
	]);

	await executePaletteCommand(page, "Open File", "File: Open File...");
	await expect(
		page.getByRole("tab", { name: /^README\.md(?:,.*)?$/ }),
	).toBeVisible();
	await expect(
		page.getByRole("code").filter({ hasText: "Primary workspace" }),
	).toBeVisible();
	openFileCalls = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
			({ command }) => command === "workspace_open_files",
		);
	});
	expect(openFileCalls).toEqual([
		{ command: "workspace_open_files", args: { request: {} } },
		{ command: "workspace_open_files", args: { request: {} } },
	]);

	await page.getByRole("tab", { name: /^Explorer / }).click();
	const explorer = page.getByRole("tree", { name: "Files Explorer" });
	await expect(explorer).toBeVisible();
	const primaryRoot = explorer.getByRole("treeitem", {
		name: "plain-workspace",
		exact: true,
	});
	const secondaryRoot = explorer.getByRole("treeitem", {
		name: "plain-library",
		exact: true,
	});
	await expect(primaryRoot).toHaveCount(1);
	await expect(secondaryRoot).toHaveCount(0);
	await executePaletteCommand(
		page,
		"Add Folder to Workspace",
		"Workspaces: Add Folder to Workspace...",
	);
	await expect(secondaryRoot).toHaveCount(1);

	const openRecentPicker = async (): Promise<Locator> => {
		await page.keyboard.press("ControlOrMeta+Shift+P");
		const palette = page.locator(".quick-input-widget");
		await expect(palette).toBeVisible();
		await palette.locator("input").pressSequentially("Open Recent");
		const command = palette.getByText("File: Open Recent...", { exact: true });
		await expect(command).toHaveCount(1);
		await command.click();
		await expect(palette.locator("input")).toHaveAttribute(
			"placeholder",
			"Select a recent workspace to open",
		);
		return palette;
	};

	let recentPicker = await openRecentPicker();
	let recentRows = recentPicker.locator(".quick-input-list .monaco-list-row");
	await expect(recentRows).toHaveCount(2);
	await expect(recentPicker).not.toContainText("/Users/");
	await expect(recentPicker).not.toContainText("plain-workspace://");
	await recentRows.filter({ hasNotText: "+ 1 folders" }).click();
	await expect(recentPicker).toBeHidden();
	await expect(primaryRoot).toHaveCount(1);
	await expect(secondaryRoot).toHaveCount(0);

	recentPicker = await openRecentPicker();
	recentRows = recentPicker.locator(".quick-input-list .monaco-list-row");
	const multiRootRecent = recentRows.filter({ hasText: "+ 1 folders" });
	await expect(multiRootRecent).toHaveCount(1);
	await multiRootRecent.click();
	await expect(recentPicker).toBeHidden();
	await expect(primaryRoot).toHaveCount(1);
	await expect(secondaryRoot).toHaveCount(1);

	recentPicker = await openRecentPicker();
	recentRows = recentPicker.locator(".quick-input-list .monaco-list-row");
	const removableMultiRoot = recentRows.filter({ hasText: "+ 1 folders" });
	await removableMultiRoot.hover();
	const removeRecentButton = removableMultiRoot.locator(
		".quick-input-list-entry-action-bar .action-label",
	);
	await expect(removeRecentButton).toHaveCount(1);
	await expect(removeRecentButton).toHaveAttribute(
		"aria-label",
		"Remove from Recently Opened",
	);
	await removeRecentButton.click();
	await expect(removableMultiRoot).toHaveCount(0);
	await expect(recentRows).toHaveCount(1);
	await page.keyboard.press("Escape");
	await expect(recentPicker).toBeHidden();

	await executePaletteCommand(
		page,
		"Clear Recently Opened",
		"File: Clear Recently Opened...",
	);
	let clearDialog = page.locator(".monaco-dialog-box");
	await expect(clearDialog).toContainText("Clear all recent workspaces?");
	await expect(clearDialog).toContainText(
		"does not delete any files or folders",
	);
	await clearDialog
		.getByRole("button", { name: "Cancel", exact: true })
		.click();
	await expect(clearDialog).toHaveCount(0);

	recentPicker = await openRecentPicker();
	await expect(
		recentPicker.locator(".quick-input-list .monaco-list-row"),
	).toHaveCount(1);
	await page.keyboard.press("Escape");
	await expect(recentPicker).toBeHidden();

	await executePaletteCommand(
		page,
		"Clear Recently Opened",
		"File: Clear Recently Opened...",
	);
	clearDialog = page.locator(".monaco-dialog-box");
	await clearDialog.getByRole("button", { name: "Clear", exact: true }).click();
	await expect(clearDialog).toHaveCount(0);
	await expect(
		page.locator(".notifications-toasts .notification-toast").filter({
			hasText: "cleared recent workspaces",
		}),
	).toHaveCount(1);
	await executePaletteCommand(page, "Open Recent", "File: Open Recent...");
	await expect(
		page.locator(".notifications-toasts .notification-toast").filter({
			hasText: "there are no recent workspaces",
		}),
	).toHaveCount(1);

	const workflowCalls = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(({ command }) =>
			[
				"workspace_open_files",
				"workspace_recent_list",
				"workspace_open_recent",
				"workspace_remove_recent",
				"workspace_clear_recent",
			].includes(command),
		);
	});
	expect(
		workflowCalls.filter(({ command }) => command === "workspace_open_recent"),
	).toHaveLength(2);
	expect(
		workflowCalls.filter(
			({ command }) => command === "workspace_remove_recent",
		),
	).toHaveLength(1);
	expect(
		workflowCalls.filter(({ command }) => command === "workspace_clear_recent"),
	).toEqual([{ command: "workspace_clear_recent", args: { request: {} } }]);
	for (const call of workflowCalls) {
		expect(JSON.stringify(call.args)).not.toContain("/Users/");
		expect(JSON.stringify(call.args)).not.toContain("plain-workspace://");
	}
	expect(nativeDialogs).toEqual([]);
	expect(errors).toEqual([]);
});

// --- `F170` S3 Rust-owned Untitled / Save As ------------------------------

test("creates Plain Untitled from the real palette and keybinding, preserves a cancelled save, publishes verified bytes, and keeps ordinary Save working", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	await installUntitledNativeIpcMock(
		page,
		{},
		{
			savePicks: [
				{ status: "cancelled" },
				{ status: "selected", name: "saved-new.txt" },
			],
		},
	);

	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	await page.keyboard.press("ControlOrMeta+Shift+P");
	const palette = page.locator(".quick-input-widget");
	await palette.locator("input").pressSequentially("New Text File");
	await expect(
		palette.getByText("File: New Untitled Text File", { exact: true }),
	).toHaveCount(1);
	await page.keyboard.press("Escape");

	await page.keyboard.press("ControlOrMeta+N");
	const activeTab = page.locator(".tabs-container .tab.active");
	await expect(activeTab).toContainText(/Untitled-[0-9]+/);
	await page.locator(".monaco-editor .view-lines").last().click();
	const marker = "F170_UNTITLED_CANCEL_THEN_SAVE";
	await page.keyboard.insertText(marker);
	await expect(activeTab).toHaveClass(/dirty/);

	await page.keyboard.press("ControlOrMeta+S");
	await expect(activeTab).toHaveClass(/dirty/);
	expect(await nativeInvocations(page, "workspace_publish_file")).toEqual([]);
	expect(await nativeInvocations(page, "scratch_discard")).toEqual([]);

	await page.keyboard.press("ControlOrMeta+S");
	await expect(activeTab).toContainText("saved-new.txt");
	await expect(activeTab).not.toHaveClass(/dirty/);
	await expect(
		page.getByRole("code").filter({ hasText: marker }),
	).toBeVisible();
	const publications = await nativeInvocations(page, "workspace_publish_file");
	expect(publications).toHaveLength(1);
	expect(publications[0]?.args).toMatchObject({
		request: {
			rootId: nativeRootId,
			relativePath: "saved-new.txt",
		},
		contentHex: hexOfText(marker),
	});
	await expect
		.poll(async () => (await nativeInvocations(page, "scratch_discard")).length)
		.toBe(1);

	await page.locator(".monaco-editor .view-lines").last().click();
	await page.keyboard.press("ControlOrMeta+End");
	await page.keyboard.insertText("_ORDINARY_SAVE");
	await expect(activeTab).toHaveClass(/dirty/);
	await page.keyboard.press("ControlOrMeta+S");
	await expect(activeTab).not.toHaveClass(/dirty/);
	const ordinaryWrites = await nativeInvocations(page, "workspace_write_file");
	expect(ordinaryWrites).toHaveLength(1);
	expect(ordinaryWrites[0]?.args).toMatchObject({
		request: { relativePath: "saved-new.txt" },
		contentHex: hexOfText(`${marker}_ORDINARY_SAVE`),
	});

	expect(await nativeInvocations(page, "scratch_create")).toHaveLength(1);
	expect(errors).toEqual([]);
});

test("requires DOM overwrite consent, rejects a stale picker version without closing Untitled, then succeeds from a fresh receipt", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (
			message.type() === "error" &&
			!message
				.text()
				.includes("The workspace file changed before it could be written.")
		) {
			errors.push(message.text());
		}
	});
	await installUntitledNativeIpcMock(
		page,
		{ "existing.txt": "ORIGINAL_EXISTING\n" },
		{
			savePicks: [
				{ status: "selected", name: "existing.txt" },
				{ status: "selected", name: "existing.txt" },
				{ status: "selected", name: "existing.txt" },
			],
		},
	);
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);
	const marker = "F170_OVERWRITE_VERSIONED";
	const activeTab = await createDirtyUntitled(page, marker);

	await page.keyboard.press("ControlOrMeta+S");
	let dialog = page.locator(".monaco-dialog-box");
	await expect(dialog).toContainText("Replace 'existing.txt'?");
	await expect(dialog).toContainText("existing file will be replaced");
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await expect(activeTab).toHaveClass(/dirty/);
	expect(await nativeInvocations(page, "workspace_write_file")).toEqual([]);

	await page.keyboard.press("ControlOrMeta+S");
	dialog = page.locator(".monaco-dialog-box");
	await expect(dialog).toContainText("Replace 'existing.txt'?");
	await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_EXTERNAL_WRITE__(
				name: string,
				content: string,
				emitWake: boolean,
			): void;
		};
		testWindow.__PLAIN_TEST_EXTERNAL_WRITE__(
			"existing.txt",
			"EXTERNAL_VERSION_WON\n",
			false,
		);
	});
	await dialog.getByRole("button", { name: "Replace", exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await expect(activeTab).toHaveClass(/dirty/);
	await expect(
		page.locator(".notifications-toasts .notification-toast").filter({
			hasText: "workspace file changed before it could be written",
		}),
	).toHaveCount(1);
	expect(await nativeInvocations(page, "workspace_write_file")).toHaveLength(1);
	expect(await nativeInvocations(page, "scratch_discard")).toEqual([]);

	await page.keyboard.press("ControlOrMeta+S");
	dialog = page.locator(".monaco-dialog-box");
	await dialog.getByRole("button", { name: "Replace", exact: true }).click();
	await expect(activeTab).toContainText("existing.txt");
	await expect(activeTab).not.toHaveClass(/dirty/);
	await expect(
		page.getByRole("code").filter({ hasText: marker }),
	).toBeVisible();
	expect(await nativeInvocations(page, "workspace_write_file")).toHaveLength(2);
	expect(await nativeInvocations(page, "workspace_publish_file")).toEqual([]);
	await expect
		.poll(async () => (await nativeInvocations(page, "scratch_discard")).length)
		.toBe(1);
	expect(errors).toEqual([]);
});

test("keeps close confirmation inside DOM and makes Cancel, Don't Save, and Save branches side-effect exact", async ({
	page,
}) => {
	const errors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	await installUntitledNativeIpcMock(
		page,
		{},
		{
			savePicks: [{ status: "selected", name: "saved-on-close.txt" }],
		},
	);
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	let activeTab = await createDirtyUntitled(page, "F170_CLOSE_DISCARD");
	await page.keyboard.press("ControlOrMeta+W");
	let dialog = page.locator(".monaco-dialog-box");
	await expect(dialog).toContainText("Do you want to save the changes");
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(activeTab).toBeVisible();
	await expect(activeTab).toHaveClass(/dirty/);
	expect(await nativeInvocations(page, "scratch_discard")).toEqual([]);

	await page.keyboard.press("ControlOrMeta+W");
	dialog = page.locator(".monaco-dialog-box");
	await dialog.getByRole("button", { name: "Don't Save", exact: true }).click();
	await expect(activeTab).toHaveCount(0);
	await expect
		.poll(async () => (await nativeInvocations(page, "scratch_discard")).length)
		.toBe(1);
	expect(await nativeInvocations(page, "workspace_publish_file")).toEqual([]);

	activeTab = await createDirtyUntitled(page, "F170_CLOSE_SAVE");
	await page.keyboard.press("ControlOrMeta+W");
	dialog = page.locator(".monaco-dialog-box");
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await expect(activeTab).toContainText("saved-on-close.txt");
	await expect(activeTab).not.toHaveClass(/dirty/);
	expect(await nativeInvocations(page, "workspace_publish_file")).toHaveLength(
		1,
	);
	await expect
		.poll(async () => (await nativeInvocations(page, "scratch_discard")).length)
		.toBe(2);
	expect(nativeDialogs).toEqual([]);
	expect(errors).toEqual([]);
});

test("restores Rust scratch as one dirty Untitled across a simulated process reload and never resurrects it after verified Save As", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	await installUntitledNativeIpcMock(
		page,
		{},
		{
			persistScratchForTest: true,
			savePicks: [{ status: "selected", name: "restored-save.txt" }],
		},
	);
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);
	const marker = "F170_SCRATCH_PROCESS_RECOVERY";
	await createDirtyUntitled(page, marker);
	await expect
		.poll(async () => {
			const writes = await nativeInvocations(page, "scratch_write");
			return writes.at(-1)?.args.contentHex;
		})
		.toBe(hexOfText(marker));

	await page.reload();
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);
	let activeTab = page.locator(".tabs-container .tab.active");
	await expect(activeTab).toHaveClass(/dirty/);
	await expect(
		page.getByRole("code").filter({ hasText: marker }),
	).toBeVisible();
	expect(await nativeInvocations(page, "scratch_read_all")).toHaveLength(2);

	await page.keyboard.press("ControlOrMeta+S");
	await expect(activeTab).toContainText("restored-save.txt");
	await expect(activeTab).not.toHaveClass(/dirty/);
	await expect
		.poll(async () => (await nativeInvocations(page, "scratch_discard")).length)
		.toBe(1);
	expect(await nativeInvocations(page, "workspace_publish_file")).toHaveLength(
		1,
	);

	await page.reload();
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);
	activeTab = page.locator(".tabs-container .tab.active");
	await expect(activeTab).toHaveCount(0);
	await expect(page.getByRole("code").filter({ hasText: marker })).toHaveCount(
		0,
	);
	expect(errors).toEqual([]);
});

// --- `F170` S4 local window lifecycle ------------------------------------

test("opens independent empty windows from the real palette and keybinding without disturbing the dirty source window", async ({
	page,
}) => {
	const errors: string[] = [];
	const watchPage = (candidate: Page): void => {
		candidate.on("pageerror", (error) => errors.push(error.message));
		candidate.on("console", (message) => {
			if (message.type() === "error") errors.push(message.text());
		});
	};
	watchPage(page);
	page.context().on("page", watchPage);

	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);
	await executePaletteCommand(page, "Open Folder", "File: Open Folder...");
	await page.getByRole("tab", { name: /^Explorer / }).click();
	const explorer = page.getByRole("tree", { name: "Files Explorer" });
	const sourceRoot = explorer.getByRole("treeitem", {
		name: "plain-workspace",
		exact: true,
	});
	await expect(sourceRoot).toHaveCount(1);
	await explorer
		.getByRole("treeitem", { name: "README.md", exact: true })
		.dblclick();
	await page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "# Plain browser workspace" })
		.click();
	await page.keyboard.press("End");
	await page.keyboard.insertText(" F170_SOURCE_WINDOW_DIRTY");
	const sourceTab = page.locator(".tabs-container .tab.active");
	await expect(sourceTab).toHaveClass(/dirty/);

	const paletteWindowPromise = page.context().waitForEvent("page");
	await executePaletteCommand(page, "New Window", "File: New Window");
	const paletteWindow = await paletteWindowPromise;
	await expect(paletteWindow.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);
	await paletteWindow.getByRole("tab", { name: /^Explorer / }).click();
	await expect(
		paletteWindow.getByRole("tree", { name: "Files Explorer" }),
	).toHaveCount(0);
	await expect(paletteWindow.locator(".tabs-container .tab")).toHaveCount(0);
	await expectPaletteCommandHidden(
		paletteWindow,
		"Close Folder",
		"File: Close Folder",
	);
	await paletteWindow.close();

	const shortcutWindowPromise = page.context().waitForEvent("page");
	await page.keyboard.press("ControlOrMeta+Shift+N");
	const shortcutWindow = await shortcutWindowPromise;
	await expect(shortcutWindow.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);
	await shortcutWindow.getByRole("tab", { name: /^Explorer / }).click();
	await expect(
		shortcutWindow.getByRole("tree", { name: "Files Explorer" }),
	).toHaveCount(0);
	await shortcutWindow.close();

	await expect(sourceRoot).toHaveCount(1);
	await expect(sourceTab).toHaveClass(/dirty/);
	await expect(
		page.getByRole("code").filter({ hasText: "F170_SOURCE_WINDOW_DIRTY" }),
	).toBeVisible();
	await expect(
		page.locator(".notifications-toasts .notification-toast"),
	).toHaveCount(0);
	expect(errors).toEqual([]);
});

test("flushes the latest workspace bytes before Close Folder, keeps Untitled local, and restores the dirty file after reauthorization", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	await installUntitledNativeIpcMock(page, {}, { persistScratchForTest: true });

	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);
	await expectPaletteCommandHidden(page, "Close Folder", "File: Close Folder");
	await executePaletteCommand(page, "Open Folder", "File: Open Folder...");
	await page.getByRole("tab", { name: /^Explorer / }).click();
	let explorer = page.getByRole("tree", { name: "Files Explorer" });
	const root = explorer.getByRole("treeitem", {
		name: "native-workspace",
		exact: true,
	});
	await explorer
		.getByRole("treeitem", { name: "README.md", exact: true })
		.dblclick();
	const workspaceTab = page.locator(".tabs-container .tab", {
		hasText: "README.md",
	});
	const editorLine = page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "Read-only Explorer fixture." });
	await editorLine.click();
	await page.keyboard.press("End");
	await page.keyboard.insertText(" F170_CLOSE_BASELINE");
	await expect(workspaceTab).toHaveClass(/dirty/);
	// Wait for the ordinary delayed workspace backup to capture only the
	// baseline, then prepare an independent Rust scratch before inserting the
	// final workspace tail immediately ahead of the topology mutation.
	await expect
		.poll(async () => (await nativeInvocations(page, "backup_write")).length, {
			timeout: 5_000,
		})
		.toBe(1);
	await createDirtyUntitled(page, "F170_UNTITLED_STAYS");
	const untitledTab = page.locator(".tabs-container .tab", {
		hasText: "F170_UNTITLED_STAYS",
	});
	await workspaceTab.click();
	await editorLine.click();
	await page.keyboard.press("End");
	await page.keyboard.insertText(" F170_CLOSE_LATEST");
	await page.keyboard.press("ControlOrMeta+K");
	await page.keyboard.press("F");

	await expect(root).toHaveCount(0);
	await expect(page.getByRole("tree", { name: "Files Explorer" })).toHaveCount(
		0,
	);
	await expect(untitledTab).toBeVisible();
	await expect(untitledTab).toHaveClass(/dirty/);
	await untitledTab.click();
	await expect(
		page.getByRole("code").filter({ hasText: "F170_UNTITLED_STAYS" }),
	).toBeVisible();
	const topologyCalls = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		return testWindow.__PLAIN_TEST_TAURI_CALLS__;
	});
	const latestBackupIndex = topologyCalls.findIndex(
		({ command, args }) =>
			command === "backup_write" &&
			typeof args.contentHex === "string" &&
			Buffer.from(args.contentHex, "hex")
				.toString("utf8")
				.includes("F170_CLOSE_LATEST"),
	);
	const closeFolderIndex = topologyCalls.findIndex(
		({ command }) => command === "workspace_close_folder",
	);
	expect(latestBackupIndex).toBeGreaterThanOrEqual(0);
	expect(closeFolderIndex).toBeGreaterThan(latestBackupIndex);
	expect(topologyCalls[closeFolderIndex]?.args).toEqual({ request: {} });

	// A reload removes the still-open editor from memory while retaining the
	// Rust-shaped backup/scratch stores. The workspace copy must stay hidden
	// until the same root is explicitly authorized again.
	await page.reload();
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);
	await expect(
		page.locator(".tabs-container .tab", { hasText: "README.md" }),
	).toHaveCount(0);
	await expect(
		page.locator(".tabs-container .tab", { hasText: "F170_UNTITLED_STAYS" }),
	).toHaveClass(/dirty/);
	await executePaletteCommand(page, "Open Folder", "File: Open Folder...");
	explorer = page.getByRole("tree", { name: "Files Explorer" });
	if ((await explorer.count()) === 0) {
		await page.getByRole("tab", { name: /^Explorer / }).click();
	}
	await expect(explorer).toBeVisible();
	await expect(
		explorer.getByRole("treeitem", {
			name: "native-workspace",
			exact: true,
		}),
	).toHaveCount(1);
	const restoredWorkspaceTab = page.locator(".tabs-container .tab", {
		hasText: "README.md",
	});
	await expect(restoredWorkspaceTab).toBeVisible();
	await expect(restoredWorkspaceTab).toHaveClass(/dirty/);
	await restoredWorkspaceTab.click();
	await expect(
		page.getByRole("code").filter({
			hasText: "F170_CLOSE_BASELINE F170_CLOSE_LATEST",
		}),
	).toBeVisible();
	await expect(
		page.locator(".notifications-toasts .notification-toast"),
	).toHaveCount(0);
	expect(errors).toEqual([]);
});

test("covers the browser multi-root remove lifecycle through Explorer and palette", async ({
	page,
}) => {
	const errors: string[] = [];
	const nativeDialogs: string[] = [];
	await installMultiRootNativeIpcMock(page);
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});

	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);
	await executePaletteCommand(page, "Open Folder", "File: Open Folder...");
	await page.getByRole("tab", { name: /^Explorer / }).click();
	const explorer = page.getByRole("tree", { name: "Files Explorer" });
	await expect(explorer).toBeVisible();
	const primaryRoot = explorer.getByRole("treeitem", {
		name: "plain-workspace",
		exact: true,
	});
	const secondaryRoot = explorer.getByRole("treeitem", {
		name: "plain-library",
		exact: true,
	});
	await expect(primaryRoot).toHaveCount(1);
	await expect(secondaryRoot).toHaveCount(0);

	await executePaletteCommand(
		page,
		"Add Folder to Workspace",
		"Workspaces: Add Folder to Workspace...",
	);
	await expect(primaryRoot).toHaveCount(1);
	await expect(secondaryRoot).toHaveCount(1);
	const expandRoot = async (root: Locator): Promise<void> => {
		if ((await root.getAttribute("aria-expanded")) !== "true") {
			await root.click();
			await page.keyboard.press("ArrowRight");
		}
		await expect(root).toHaveAttribute("aria-expanded", "true");
	};
	await expandRoot(primaryRoot);
	await expect(
		explorer.getByRole("treeitem", { name: "README.md", exact: true }),
	).toHaveCount(1);
	await expandRoot(secondaryRoot);
	const secondaryFile = explorer.getByRole("treeitem", {
		name: "notes.txt",
		exact: true,
	});
	await expect(secondaryFile).toHaveCount(1);

	await expect
		.poll(async () =>
			page.evaluate(
				({ primaryRootId, secondaryRootId }) => {
					const testWindow = window as unknown as Window & {
						__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__: TestWorkspaceWatchExchange[];
					};
					const exchanges = testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__;
					return [primaryRootId, secondaryRootId].every(
						(rootId) =>
							exchanges.some(({ result }) =>
								result.roots.some(
									(root) =>
										root.rootId === rootId &&
										root.generation === 1 &&
										root.rescanRequired,
								),
							) &&
							exchanges.some(({ request }) =>
								request.roots.some(
									(root) =>
										root.rootId === rootId && root.acknowledgedGeneration === 1,
								),
							),
					);
				},
				{
					primaryRootId: nativeRootId,
					secondaryRootId: nativeSecondaryRootId,
				},
			),
		)
		.toBe(true);

	const topologyCallCount = async (): Promise<number> =>
		page.evaluate(() => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(({ command }) =>
				[
					"workspace_snapshot",
					"workspace_pick_roots",
					"workspace_remove_root",
				].includes(command),
			).length;
		});
	const topologyCallsBeforeGenericProbes = await topologyCallCount();
	for (const [query, title] of [
		["Open Workspace from File", "Open Workspace from File..."],
		["Open Workspace Configuration", "Open Workspace Configuration File"],
		["Close Workspace", "Close Workspace"],
		["Save Workspace As", "Save Workspace As..."],
		["Duplicate As Workspace", "Duplicate As Workspace in New Window"],
	] as const) {
		await expectPaletteTitleHidden(page, query, title);
	}
	expect(await topologyCallCount()).toBe(topologyCallsBeforeGenericProbes);

	await activateExplorerContextAction(
		page,
		secondaryRoot,
		"Remove Folder from Workspace",
	);
	await expect(secondaryRoot).toHaveCount(0);
	await expect(secondaryFile).toHaveCount(0);
	await expect(primaryRoot).toHaveCount(1);
	await expect
		.poll(async () =>
			page.evaluate(() => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				};
				return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
					({ command }) => command === "workspace_remove_root",
				).length;
			}),
		)
		.toBe(1);
	const postSecondaryAcceptanceExchangeStart = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__: TestWorkspaceWatchExchange[];
		};
		return testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__.length;
	});

	// This is a deterministic fixture-authority invariant. Production Rust root
	// capability revocation is covered by the native contract tests.
	const revokedInvalidation = await page.evaluate(
		({ rootId }) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE__(
					rootId: string,
					name: string,
					emitWake: boolean,
				): number;
			};
			try {
				testWindow.__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE__(
					rootId,
					"revoked.txt",
					true,
				);
				return undefined;
			} catch (error) {
				return error;
			}
		},
		{ rootId: nativeSecondaryRootId },
	);
	expect(revokedInvalidation).toEqual({
		code: "ROOT_NOT_AUTHORIZED",
		message: "The workspace root is not authorized.",
	});
	const staleWakeDeliveries = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_MULTI_ROOT_EMIT_WAKE__(): number;
		};
		return testWindow.__PLAIN_TEST_MULTI_ROOT_EMIT_WAKE__();
	});
	expect(staleWakeDeliveries).toBe(1);
	await page.evaluate(
		({ rootId }) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE__(
					rootId: string,
					name: string,
					emitWake: boolean,
				): number;
			};
			testWindow.__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE__(
				rootId,
				"alive.txt",
				true,
			);
		},
		{ rootId: nativeRootId },
	);
	await expect(
		explorer.getByRole("treeitem", { name: "alive.txt", exact: true }),
	).toHaveCount(1);
	await expect
		.poll(async () =>
			page.evaluate(
				({ exchangeStart, rootId }) => {
					const testWindow = window as unknown as Window & {
						__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__: TestWorkspaceWatchExchange[];
					};
					const exchanges =
						testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__.slice(
							exchangeStart,
						);
					return (
						exchanges.some(
							({ result }) =>
								result.roots.length === 1 &&
								result.roots[0]?.rootId === rootId &&
								result.roots[0].generation === 2 &&
								result.roots[0].rescanRequired,
						) &&
						exchanges.some(
							({ request }) =>
								request.roots.length === 1 &&
								request.roots[0]?.rootId === rootId &&
								request.roots[0].acknowledgedGeneration === 2,
						)
					);
				},
				{
					exchangeStart: postSecondaryAcceptanceExchangeStart,
					rootId: nativeRootId,
				},
			),
		)
		.toBe(true);
	const postRemovalWatchExchanges = await page.evaluate(
		({ exchangeStart }) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__: TestWorkspaceWatchExchange[];
			};
			return testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__.slice(
				exchangeStart,
			);
		},
		{ exchangeStart: postSecondaryAcceptanceExchangeStart },
	);
	for (const exchange of postRemovalWatchExchanges) {
		expect(
			exchange.request.roots.some(
				({ rootId }) => rootId === nativeSecondaryRootId,
			),
		).toBe(false);
		expect(
			exchange.result.roots.some(
				({ rootId }) => rootId === nativeSecondaryRootId,
			),
		).toBe(false);
		expect(JSON.stringify(exchange)).not.toMatch(
			/(?:absolute|canonical|native|relative)path/iu,
		);
	}

	await removeWorkspaceRootViaPalette(page, "plain-workspace");
	await expect(primaryRoot).toHaveCount(0);
	await expect(secondaryRoot).toHaveCount(0);
	await expect(page.getByRole("tree", { name: "Files Explorer" })).toHaveCount(
		0,
	);
	await expect(page.locator("body")).not.toHaveAttribute(
		"data-plain-workspace-projection",
		"reload-required",
	);
	await expect
		.poll(async () =>
			page.evaluate(() => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_MULTI_ROOT_WATCH_LISTENER_COUNT__(): number;
				};
				return testWindow.__PLAIN_TEST_MULTI_ROOT_WATCH_LISTENER_COUNT__();
			}),
		)
		.toBe(0);
	const finalAcceptedWatcherWatermark = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__: TestWorkspaceWatchExchange[];
		};
		return {
			callCount: testWindow.__PLAIN_TEST_TAURI_CALLS__.length,
			exchangeCount: testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__.length,
		};
	});
	const finalWakeDeliveries = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_MULTI_ROOT_EMIT_WAKE__(): number;
		};
		return testWindow.__PLAIN_TEST_MULTI_ROOT_EMIT_WAKE__();
	});
	expect(finalWakeDeliveries).toBe(0);
	const finalWatcherEvidence = await page.evaluate(
		({ callCount, exchangeCount }) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__: TestWorkspaceWatchExchange[];
			};
			return {
				watchCommandsAfterAcceptedEmpty: testWindow.__PLAIN_TEST_TAURI_CALLS__
					.slice(callCount)
					.filter(({ command }) => command === "workspace_watch_sync"),
				watchExchangesAfterAcceptedEmpty:
					testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__.slice(
						exchangeCount,
					),
			};
		},
		finalAcceptedWatcherWatermark,
	);
	expect(finalWatcherEvidence.watchCommandsAfterAcceptedEmpty).toEqual([]);
	expect(finalWatcherEvidence.watchExchangesAfterAcceptedEmpty).toEqual([]);
	// Keep the mock authorization state honest without presenting it as native
	// filesystem evidence.
	const finalRootInvalidation = await page.evaluate(
		({ rootId }) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE__(
					rootId: string,
					name: string,
					emitWake: boolean,
				): number;
			};
			try {
				testWindow.__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE__(
					rootId,
					"revoked-final.txt",
					true,
				);
				return undefined;
			} catch (error) {
				return error;
			}
		},
		{ rootId: nativeRootId },
	);
	expect(finalRootInvalidation).toEqual({
		code: "ROOT_NOT_AUTHORIZED",
		message: "The workspace root is not authorized.",
	});
	await expect(primaryRoot).toHaveCount(0);
	await expect(secondaryRoot).toHaveCount(0);

	await expectPaletteTitleHidden(
		page,
		"Remove Folder from Workspace",
		"Workspaces: Remove Folder from Workspace...",
	);
	await expectPaletteTitleHidden(
		page,
		"Add Folder to Workspace",
		"Workspaces: Add Folder to Workspace...",
	);
	await page.keyboard.press("ControlOrMeta+Shift+P");
	const palette = page.locator(".quick-input-widget");
	await expect(palette).toBeVisible();
	await palette.locator("input").pressSequentially("Open Folder");
	await expect(
		palette.getByText("File: Open Folder...", { exact: true }),
	).toHaveCount(1);
	await page.keyboard.press("Escape");
	await expect(palette).toBeHidden();

	const removeRequests = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		return testWindow.__PLAIN_TEST_TAURI_CALLS__
			.filter(({ command }) => command === "workspace_remove_root")
			.map(({ args }) => args.request);
	});
	expect(removeRequests).toEqual([
		{ rootId: nativeSecondaryRootId },
		{ rootId: nativeRootId },
	]);
	const rawWatcherEvidence = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__: TestWorkspaceWatchExchange[];
		};
		return {
			invocations: testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
				({ command }) => command === "workspace_watch_sync",
			),
			exchanges: testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__,
		};
	});
	expect(rawWatcherEvidence.invocations.length).toBeGreaterThan(0);
	for (const { args } of rawWatcherEvidence.invocations) {
		expect(Reflect.ownKeys(args)).toEqual(["request"]);
		const request = args.request as { roots: unknown };
		expect(Reflect.ownKeys(request)).toEqual(["roots"]);
		expect(Array.isArray(request.roots)).toBe(true);
		expect((request.roots as unknown[]).length).toBeGreaterThan(0);
		for (const root of request.roots as Record<string, unknown>[]) {
			expect(Reflect.ownKeys(root)).toEqual([
				"rootId",
				"acknowledgedGeneration",
			]);
			expect([nativeRootId, nativeSecondaryRootId]).toContain(root.rootId);
			expect(
				root.acknowledgedGeneration === null ||
					(Number.isSafeInteger(root.acknowledgedGeneration) &&
						(root.acknowledgedGeneration as number) >= 1 &&
						(root.acknowledgedGeneration as number) <= 0xffff_ffff),
			).toBe(true);
		}
	}
	for (const exchange of rawWatcherEvidence.exchanges) {
		expect(Reflect.ownKeys(exchange)).toEqual([
			"callIndex",
			"request",
			"result",
		]);
		expect(Number.isSafeInteger(exchange.callIndex)).toBe(true);
		expect(exchange.callIndex).toBeGreaterThanOrEqual(0);
		expect(Reflect.ownKeys(exchange.result)).toEqual(["workspaceId", "roots"]);
		expect(exchange.result.workspaceId).toBe(nativeWorkspaceId);
		for (const root of exchange.result.roots) {
			expect(Reflect.ownKeys(root)).toEqual([
				"rootId",
				"generation",
				"rescanRequired",
			]);
			expect([nativeRootId, nativeSecondaryRootId]).toContain(root.rootId);
			expect(Number.isSafeInteger(root.generation)).toBe(true);
			expect(root.generation).toBeGreaterThanOrEqual(1);
			expect(root.generation).toBeLessThanOrEqual(0xffff_ffff);
			expect(typeof root.rescanRequired).toBe("boolean");
		}
	}
	await expect(
		page.locator(".notifications-toasts .notification-toast"),
	).toHaveCount(0);
	expect(nativeDialogs).toEqual([]);
	expect(errors).toEqual([]);
});

test("converges both workspace roots after watcher wakes and lost-wake timer pulls", async ({
	page,
}) => {
	const errors: string[] = [];
	const nativeDialogs: string[] = [];
	await installMultiRootNativeIpcMock(page);
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});

	const explorer = await openNativeWorkspaceExplorer(page);
	await executePaletteCommand(
		page,
		"Add Folder to Workspace",
		"Workspaces: Add Folder to Workspace...",
	);
	const primaryRoot = explorer.getByRole("treeitem", {
		name: "plain-workspace",
		exact: true,
	});
	const secondaryRoot = explorer.getByRole("treeitem", {
		name: "plain-library",
		exact: true,
	});
	const expandRoot = async (root: Locator): Promise<void> => {
		if ((await root.getAttribute("aria-expanded")) !== "true") {
			await root.click();
			await page.keyboard.press("ArrowRight");
		}
		await expect(root).toHaveAttribute("aria-expanded", "true");
	};
	await expect(primaryRoot).toHaveCount(1);
	await expect(secondaryRoot).toHaveCount(1);
	await expandRoot(primaryRoot);
	await expandRoot(secondaryRoot);

	let exchangeWatermark = await waitForMultiRootWatchBaseline(page);
	await expect
		.poll(() =>
			page.evaluate(() => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_MULTI_ROOT_WATCH_LISTENER_COUNT__(): number;
				};
				return testWindow.__PLAIN_TEST_MULTI_ROOT_WATCH_LISTENER_COUNT__();
			}),
		)
		.toBe(1);

	const phases = [
		{
			rootId: nativeRootId,
			name: "primary-wake.txt",
			emitWake: true,
			generation: 2,
			beforeAcknowledgements: [1, 1],
			afterAcknowledgements: [2, 1],
			transitionTimeout: 1_800,
		},
		{
			rootId: nativeRootId,
			name: "primary-timer.txt",
			emitWake: false,
			generation: 3,
			beforeAcknowledgements: [2, 1],
			afterAcknowledgements: [3, 1],
			transitionTimeout: 7_000,
		},
		{
			rootId: nativeSecondaryRootId,
			name: "secondary-wake.txt",
			emitWake: true,
			generation: 2,
			beforeAcknowledgements: [3, 1],
			afterAcknowledgements: [3, 2],
			transitionTimeout: 1_800,
		},
		{
			rootId: nativeSecondaryRootId,
			name: "secondary-timer.txt",
			emitWake: false,
			generation: 3,
			beforeAcknowledgements: [3, 2],
			afterAcknowledgements: [3, 3],
			transitionTimeout: 7_000,
		},
	] as const satisfies readonly {
		rootId: string;
		name: string;
		emitWake: boolean;
		generation: number;
		beforeAcknowledgements: TestMultiRootWatchAcknowledgements;
		afterAcknowledgements: TestMultiRootWatchAcknowledgements;
		transitionTimeout: number;
	}[];

	for (const phase of phases) {
		const createdEntry = explorer.getByRole("treeitem", {
			name: phase.name,
			exact: true,
		});
		await expect(createdEntry).toHaveCount(0);
		const phaseStart = exchangeWatermark;
		const wakeDeliveries = await page.evaluate(
			async ({ emitWake, name, rootId }) => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE__(
						rootId: string,
						name: string,
						emitWake: boolean,
					): number;
					__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE_AFTER_NEXT_SYNC__(
						rootId: string,
						name: string,
						emitWake: boolean,
					): Promise<number>;
				};
				return emitWake
					? testWindow.__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE_AFTER_NEXT_SYNC__(
							rootId,
							name,
							emitWake,
						)
					: testWindow.__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE__(
							rootId,
							name,
							emitWake,
						);
			},
			phase,
		);
		expect(wakeDeliveries).toBe(phase.emitWake ? 1 : 0);

		exchangeWatermark = await waitForMultiRootWatchTransition(
			page,
			phaseStart,
			phase.beforeAcknowledgements,
			phase.rootId,
			phase.generation,
			phase.afterAcknowledgements,
			phase.transitionTimeout,
		);
		const phaseEvidence = await page.evaluate(
			({ end, generation, name, rootId, start }) => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
					__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__: TestWorkspaceWatchExchange[];
					__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGE_TIMINGS__: TestWorkspaceWatchExchangeTiming[];
					__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE_TIMINGS__: TestMultiRootExternalCreateTiming[];
				};
				const exchanges =
					testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__.slice(start, end);
				const pendingExchange = exchanges.find(
					({ result }) =>
						result.roots.length === 1 &&
						result.roots[0]?.rootId === rootId &&
						result.roots[0].generation === generation,
				);
				const pendingTiming =
					pendingExchange === undefined
						? undefined
						: testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGE_TIMINGS__.find(
								({ callIndex }) => callIndex === pendingExchange.callIndex,
							);
				const injectionTiming =
					testWindow.__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE_TIMINGS__.find(
						(timing) => timing.rootId === rootId && timing.name === name,
					);
				return {
					exchanges,
					invocations: exchanges.map(
						({ callIndex }) => testWindow.__PLAIN_TEST_TAURI_CALLS__[callIndex],
					),
					injectionToPendingMs:
						pendingTiming === undefined || injectionTiming === undefined
							? undefined
							: pendingTiming.observedAt - injectionTiming.injectedAt,
				};
			},
			{
				end: exchangeWatermark,
				generation: phase.generation,
				name: phase.name,
				rootId: phase.rootId,
				start: phaseStart,
			},
		);
		const phaseExchanges = phaseEvidence.exchanges;
		expect(phaseExchanges.length).toBeGreaterThanOrEqual(2);
		expect(phaseEvidence.invocations).toHaveLength(phaseExchanges.length);
		expect(phaseEvidence.injectionToPendingMs).toBeGreaterThanOrEqual(0);
		if (phase.emitWake) {
			expect(phaseEvidence.injectionToPendingMs).toBeLessThan(1_800);
		}
		let pendingCount = 0;
		for (const [index, exchange] of phaseExchanges.entries()) {
			const invocation = phaseEvidence.invocations[index];
			expect(invocation?.command).toBe("workspace_watch_sync");
			expect(Reflect.ownKeys(invocation?.args ?? {})).toEqual(["request"]);
			const rawRequest = invocation?.args.request as
				{ roots?: readonly Record<string, unknown>[] } | undefined;
			expect(Reflect.ownKeys(rawRequest ?? {})).toEqual(["roots"]);
			expect(rawRequest?.roots).toHaveLength(2);
			for (const root of rawRequest?.roots ?? []) {
				expect(Reflect.ownKeys(root)).toEqual([
					"rootId",
					"acknowledgedGeneration",
				]);
			}
			expect(JSON.stringify(invocation)).not.toMatch(
				/(?:absolute|canonical|native|relative|file)?path/iu,
			);
			expect(exchange.result.workspaceId).toBe(nativeWorkspaceId);
			expect(exchange.request.roots).toHaveLength(2);
			expect(exchange.request.roots.map(({ rootId }) => rootId)).toEqual([
				nativeRootId,
				nativeSecondaryRootId,
			]);
			const acknowledgements = exchange.request.roots.map(
				({ acknowledgedGeneration }) => acknowledgedGeneration,
			);
			expect([
				phase.beforeAcknowledgements,
				phase.afterAcknowledgements,
			]).toContainEqual(acknowledgements);
			if (exchange.result.roots.length > 0) {
				pendingCount += 1;
				expect(exchange.result.roots).toEqual([
					{
						rootId: phase.rootId,
						generation: phase.generation,
						rescanRequired: true,
					},
				]);
			}
			expect(JSON.stringify(exchange)).not.toMatch(
				/(?:absolute|canonical|native|relative|file)?path/iu,
			);
		}
		expect(pendingCount).toBeGreaterThanOrEqual(1);
		const acceptedExchange = phaseExchanges.at(-1);
		expect(
			acceptedExchange?.request.roots.map(
				({ acknowledgedGeneration }) => acknowledgedGeneration,
			),
		).toEqual(phase.afterAcknowledgements);
		expect(acceptedExchange?.result.roots).toEqual([]);
		await expect(createdEntry).toHaveCount(1, { timeout: 5_000 });
	}

	const finalEvidence = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_MULTI_ROOT_WATCH_LISTENER_COUNT__(): number;
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		const mutationCommands = new Set([
			"workspace_write_file",
			"workspace_create_file",
			"workspace_create_directory",
			"workspace_rename",
			"workspace_copy",
			"workspace_move",
			"workspace_prepare_delete",
			"workspace_execute_delete",
		]);
		return {
			listenerCount:
				testWindow.__PLAIN_TEST_MULTI_ROOT_WATCH_LISTENER_COUNT__(),
			mutationCalls: testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
				({ command }) => mutationCommands.has(command),
			),
		};
	});
	expect(finalEvidence.listenerCount).toBe(1);
	expect(finalEvidence.mutationCalls).toEqual([]);
	await expect(
		page.locator(".notifications-toasts .notification-toast"),
	).toHaveCount(0);
	expect(nativeDialogs).toEqual([]);
	expect(errors).toEqual([]);
});

test("shows missing-parent create failures for both workspace roots", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	await installMultiRootNativeIpcMock(page, "supported");
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});

	const explorer = await openNativeWorkspaceExplorer(page);
	await executePaletteCommand(
		page,
		"Add Folder to Workspace",
		"Workspaces: Add Folder to Workspace...",
	);
	const primaryRoot = explorer.getByRole("treeitem", {
		name: "plain-workspace",
		exact: true,
	});
	const secondaryRoot = explorer.getByRole("treeitem", {
		name: "plain-library",
		exact: true,
	});
	const expandRoot = async (root: Locator): Promise<void> => {
		if ((await root.getAttribute("aria-expanded")) !== "true") {
			await root.click();
			await page.keyboard.press("ArrowRight");
		}
		await expect(root).toHaveAttribute("aria-expanded", "true");
	};
	await expect(primaryRoot).toHaveCount(1);
	await expect(secondaryRoot).toHaveCount(1);
	await expandRoot(primaryRoot);
	await expandRoot(secondaryRoot);
	await expect(
		explorer.getByRole("treeitem", { name: "README.md", exact: true }),
	).toHaveCount(1);
	await expect(
		explorer.getByRole("treeitem", { name: "notes.txt", exact: true }),
	).toHaveCount(1);

	const callStart = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		return testWindow.__PLAIN_TEST_TAURI_CALLS__.length;
	});
	const createCommandCount = async (command: string): Promise<number> =>
		page.evaluate(
			({ callStart, command }) => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				};
				return testWindow.__PLAIN_TEST_TAURI_CALLS__
					.slice(callStart)
					.filter((call) => call.command === command).length;
			},
			{ callStart, command },
		);
	const consumeCreateFailureNotification = async (): Promise<void> => {
		const toasts = page.locator(".notifications-toasts .notification-toast");
		await expect(toasts).toHaveCount(1);
		const toast = toasts.first();
		await expect(toast).toContainText(
			"Unable to create the Plain workspace entry",
		);
		await expect(
			toast.getByRole("button", { name: "Retry", exact: true }),
		).toHaveCount(1);
		const text = await toast.innerText();
		expect(text).not.toContain("ENTRY_NOT_FOUND");
		expect(text).not.toContain(nativeRootId);
		expect(text).not.toContain(nativeSecondaryRootId);
		expect(text).not.toMatch(/(?:\/Users\/|[A-Za-z]:\\|\\\\)/u);
		await toast
			.getByRole("button", {
				name: /^Clear Notification(?: \(.+\))?$/u,
			})
			.click();
		await expect(toasts).toHaveCount(0);
	};

	await primaryRoot.click();
	await page.getByRole("button", { name: "New File...", exact: true }).click();
	await finishExplorerNameInput(page, "missing-file-parent/new.txt");
	await expect.poll(() => createCommandCount("workspace_create_file")).toBe(1);
	await consumeCreateFailureNotification();
	await expect(
		explorer.getByRole("treeitem", {
			name: "missing-file-parent",
			exact: true,
		}),
	).toHaveCount(0);
	await expect(
		explorer.getByRole("treeitem", { name: "new.txt", exact: true }),
	).toHaveCount(0);

	await secondaryRoot.click();
	await page
		.getByRole("button", { name: "New Folder...", exact: true })
		.click();
	await finishExplorerNameInput(page, "missing-folder-parent/new-dir");
	await expect
		.poll(() => createCommandCount("workspace_create_directory"))
		.toBe(1);
	await consumeCreateFailureNotification();
	await expect(
		explorer.getByRole("treeitem", {
			name: "missing-folder-parent",
			exact: true,
		}),
	).toHaveCount(0);
	await expect(
		explorer.getByRole("treeitem", { name: "new-dir", exact: true }),
	).toHaveCount(0);

	const evidence = await page.evaluate(
		({ callStart, mutationCommands }) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			const calls = testWindow.__PLAIN_TEST_TAURI_CALLS__;
			const callsAfterStart = calls.slice(callStart);
			const missingPrefixes = ["missing-file-parent", "missing-folder-parent"];
			return {
				capabilities: calls.filter(
					({ command }) => command === "workspace_capabilities",
				),
				mutations: callsAfterStart.filter(({ command }) =>
					mutationCommands.includes(command),
				),
				targetReads: callsAfterStart.filter(({ command, args }) => {
					if (
						![
							"workspace_stat",
							"workspace_read_file",
							"workspace_read_dir",
						].includes(command)
					) {
						return false;
					}
					const request = args.request as
						{ relativePath?: unknown } | undefined;
					return (
						typeof request?.relativePath === "string" &&
						missingPrefixes.some(
							(prefix) =>
								request.relativePath === prefix ||
								(request.relativePath as string).startsWith(`${prefix}/`),
						)
					);
				}),
			};
		},
		{
			callStart,
			mutationCommands: nativeMutationCommands as readonly string[],
		},
	);
	expect(evidence.capabilities).toEqual([
		{ command: "workspace_capabilities", args: { request: {} } },
	]);
	expect(evidence.mutations).toEqual([
		{
			command: "workspace_create_file",
			args: {
				request: {
					rootId: nativeRootId,
					relativePath: "missing-file-parent/new.txt",
				},
			},
		},
		{
			command: "workspace_create_directory",
			args: {
				request: {
					rootId: nativeSecondaryRootId,
					relativePath: "missing-folder-parent/new-dir",
				},
			},
		},
	]);
	expect(evidence.targetReads).toEqual([]);
	await expect(
		page.locator(".tabs-container .tab").filter({ hasText: "new.txt" }),
	).toHaveCount(0);
	await expect(primaryRoot).toHaveCount(1);
	await expect(secondaryRoot).toHaveCount(1);
	await expect(
		explorer.getByRole("treeitem", { name: "README.md", exact: true }),
	).toHaveCount(1);
	await expect(
		explorer.getByRole("treeitem", { name: "notes.txt", exact: true }),
	).toHaveCount(1);
	await expect(
		page.locator(".notifications-toasts .notification-toast"),
	).toHaveCount(0);
	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toHaveLength(4);
	for (const diagnostic of consoleErrors) {
		expect(diagnostic).not.toContain("ENTRY_NOT_FOUND");
		expect(diagnostic).not.toContain(nativeRootId);
		expect(diagnostic).not.toContain(nativeSecondaryRootId);
	}
	expect(consoleErrors[0]).toContain("FileServiceOverride.createFile");
	expect(consoleErrors[0]).toContain(
		"FileOperationError: Unable to create the Plain workspace entry",
	);
	expect(consoleErrors[1]).toBe("Unable to create the Plain workspace entry");
	expect(consoleErrors[2]).toContain("FileServiceOverride.createFolder");
	expect(consoleErrors[2]).toContain(
		"FileOperationError: Unable to create the Plain workspace entry",
	);
	expect(consoleErrors[3]).toBe("Unable to create the Plain workspace entry");
});

test("shows retained and partial cross-root move failures", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	await installMultiRootNativeIpcMock(page, "supported", [
		"moveRetained",
		"movePartial",
	]);
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
		origin: "http://127.0.0.1:1420",
	});
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});

	const explorer = await openNativeWorkspaceExplorer(page);
	await executePaletteCommand(
		page,
		"Add Folder to Workspace",
		"Workspaces: Add Folder to Workspace...",
	);
	const primaryRoot = explorer.getByRole("treeitem", {
		name: "plain-workspace",
		exact: true,
	});
	const secondaryRoot = explorer.getByRole("treeitem", {
		name: "plain-library",
		exact: true,
	});
	const itemAtLevel = (name: string, level: number): Locator =>
		explorer
			.locator(`[role="treeitem"][aria-level="${level}"]`)
			.filter({ hasText: name });
	const expandDirectory = async (directory: Locator): Promise<void> => {
		await expect(directory).toHaveCount(1);
		if ((await directory.getAttribute("aria-expanded")) !== "true") {
			await directory.click();
			await page.keyboard.press("ArrowRight");
		}
		await expect(directory).toHaveAttribute("aria-expanded", "true");
	};
	await expandDirectory(primaryRoot);
	await expandDirectory(secondaryRoot);
	const src = itemAtLevel("src", 2);
	await expect(src).toHaveCount(1);

	const callStart = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		return testWindow.__PLAIN_TEST_TAURI_CALLS__.length;
	});
	const currentCallCount = (): Promise<number> =>
		page.evaluate(() => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			return testWindow.__PLAIN_TEST_TAURI_CALLS__.length;
		});
	const moveCount = (): Promise<number> =>
		page.evaluate(() => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
				({ command }) => command === "workspace_move",
			).length;
		});
	const expectBothRootRefreshes = async (phaseStart: number): Promise<void> => {
		await expect
			.poll(() =>
				page.evaluate(
					({ phaseStart, rootIds }) => {
						const testWindow = window as unknown as Window & {
							__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
						};
						const refreshed = new Set(
							testWindow.__PLAIN_TEST_TAURI_CALLS__
								.slice(phaseStart)
								.filter(({ command, args }) => {
									if (command !== "workspace_read_dir") {
										return false;
									}
									const request = args.request as
										{ rootId?: unknown; relativePath?: unknown } | undefined;
									return (
										request?.relativePath === "" &&
										typeof request.rootId === "string" &&
										rootIds.includes(request.rootId)
									);
								})
								.map(({ args }) => (args.request as { rootId: string }).rootId),
						);
						return rootIds.every((rootId) => refreshed.has(rootId));
					},
					{
						phaseStart,
						rootIds: [nativeRootId, nativeSecondaryRootId],
					},
				),
			)
			.toBe(true);
	};
	const moveMessage =
		"The workspace move published its target but could not remove all of its source.";
	const consumeMoveFailureToast = async (): Promise<void> => {
		const toasts = page.locator(".notifications-toasts .notification-toast");
		await expect(toasts).toHaveCount(1);
		const toast = toasts.first();
		await expect(toast).toContainText(moveMessage);
		await expect(toast).not.toContainText(
			"The file(s) to paste have been deleted or moved since you copied them.",
		);
		await expect(
			toast.getByRole("button", { name: "Retry", exact: true }),
		).toHaveCount(0);
		const text = await toast.innerText();
		expect(text).not.toContain("targetPublishedSource");
		expect(text).not.toContain("deleteFailed");
		expect(text).not.toContain("removedEntries");
		expect(text).not.toContain(nativeRootId);
		expect(text).not.toContain(nativeSecondaryRootId);
		expect(text).not.toMatch(/(?:\/Users\/|[A-Za-z]:\\|\\\\)/u);
		await toast.hover();
		await toast
			.getByRole("button", {
				name: /^Clear Notification(?: \(.+\))?$/u,
			})
			.click();
		await expect(toasts).toHaveCount(0);
	};
	const cutAndPaste = async (
		source: Locator,
		expectedMoves: number,
	): Promise<number> => {
		const phaseStart = await currentCallCount();
		await activateExplorerContextAction(page, source, "Cut");
		await expect(source.locator(".explorer-item.cut")).toHaveCount(1);
		await activateExplorerContextAction(page, src, "Paste");
		await expect.poll(moveCount).toBe(expectedMoves);
		await consumeMoveFailureToast();
		await expect(source.locator(".explorer-item.cut")).toHaveCount(0);
		await expectBothRootRefreshes(phaseStart);
		return phaseStart;
	};

	const retainedSource = itemAtLevel("move-source.txt", 2);
	await expect(retainedSource).toHaveCount(1);
	await cutAndPaste(retainedSource, 1);
	await expandDirectory(src);
	await expect(itemAtLevel("move-source.txt", 2)).toHaveCount(1);
	await expect(itemAtLevel("move-source.txt", 3)).toHaveCount(1);
	await expect(
		page.locator(".tabs-container .tab").filter({ hasText: "move-source.txt" }),
	).toHaveCount(0);

	const partialSource = itemAtLevel("move-partial", 2);
	await expandDirectory(partialSource);
	await expect(itemAtLevel("removed.txt", 3)).toHaveCount(1);
	await expect(itemAtLevel("kept.txt", 3)).toHaveCount(1);
	await cutAndPaste(partialSource, 2);
	await expandDirectory(src);
	const retainedPartialSource = itemAtLevel("move-partial", 2);
	const publishedPartialTarget = itemAtLevel("move-partial", 3);
	await expandDirectory(retainedPartialSource);
	await expandDirectory(publishedPartialTarget);
	await expect(itemAtLevel("removed.txt", 3)).toHaveCount(0);
	await expect(itemAtLevel("kept.txt", 3)).toHaveCount(1);
	await expect(itemAtLevel("removed.txt", 4)).toHaveCount(1);
	await expect(itemAtLevel("kept.txt", 4)).toHaveCount(1);
	await expect(
		page.locator(".tabs-container .tab").filter({ hasText: "move-partial" }),
	).toHaveCount(0);

	const evidence = await page.evaluate(
		({ callStart, mutationCommands }) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			return testWindow.__PLAIN_TEST_TAURI_CALLS__
				.slice(callStart)
				.filter(({ command }) => mutationCommands.includes(command));
		},
		{
			callStart,
			mutationCommands: nativeMutationCommands as readonly string[],
		},
	);
	expect(evidence).toEqual([
		{
			command: "workspace_move",
			args: {
				request: {
					sourceRootId: nativeSecondaryRootId,
					sourcePath: "move-source.txt",
					targetRootId: nativeRootId,
					targetPath: "src/move-source.txt",
				},
			},
		},
		{
			command: "workspace_move",
			args: {
				request: {
					sourceRootId: nativeSecondaryRootId,
					sourcePath: "move-partial",
					targetRootId: nativeRootId,
					targetPath: "src/move-partial",
				},
			},
		},
	]);
	await expect(
		page.locator(".notifications-toasts .notification-toast"),
	).toHaveCount(0);
	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toHaveLength(4);
	for (const diagnostic of consoleErrors) {
		expect(diagnostic).not.toContain("targetPublishedSource");
		expect(diagnostic).not.toContain("deleteFailed");
		expect(diagnostic).not.toContain("removedEntries");
		expect(diagnostic).not.toContain(nativeRootId);
		expect(diagnostic).not.toContain(nativeSecondaryRootId);
	}
	expect(consoleErrors[0]).toContain("WORKSPACE_MOVE_INCOMPLETE");
	expect(consoleErrors[0]).toContain(moveMessage);
	expect(consoleErrors[1]).toBe(moveMessage);
	expect(consoleErrors[1]).not.toMatch(/(?:\/Users\/|[A-Za-z]:\\|\\\\)/u);
	expect(consoleErrors[2]).toContain("WORKSPACE_MOVE_INCOMPLETE");
	expect(consoleErrors[2]).toContain(moveMessage);
	expect(consoleErrors[3]).toBe(moveMessage);
	expect(consoleErrors[3]).not.toMatch(/(?:\/Users\/|[A-Za-z]:\\|\\\\)/u);
});

test("shows retained and partial permanent delete failures", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	await installMultiRootNativeIpcMock(
		page,
		"supported",
		[],
		["deleteRetained", "deletePartial"],
	);
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});

	const explorer = await openNativeWorkspaceExplorer(page);
	await executePaletteCommand(
		page,
		"Add Folder to Workspace",
		"Workspaces: Add Folder to Workspace...",
	);
	const primaryRoot = explorer.getByRole("treeitem", {
		name: "plain-workspace",
		exact: true,
	});
	const secondaryRoot = explorer.getByRole("treeitem", {
		name: "plain-library",
		exact: true,
	});
	const itemAtLevel = (name: string, level: number): Locator =>
		explorer
			.locator(`[role="treeitem"][aria-level="${level}"]`)
			.filter({ hasText: name });
	const expandDirectory = async (directory: Locator): Promise<void> => {
		await expect(directory).toHaveCount(1);
		if ((await directory.getAttribute("aria-expanded")) !== "true") {
			await directory.click();
			await page.keyboard.press("ArrowRight");
		}
		await expect(directory).toHaveAttribute("aria-expanded", "true");
	};
	await expandDirectory(primaryRoot);
	await expandDirectory(secondaryRoot);

	const currentCallCount = (): Promise<number> =>
		page.evaluate(() => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			return testWindow.__PLAIN_TEST_TAURI_CALLS__.length;
		});
	const callStart = await currentCallCount();

	const deleteMessage =
		"The permanent delete batch stopped after a native delete became incomplete.";

	const expectRootRefresh = async (
		phaseStart: number,
		rootId: string,
		relativePath: string,
	): Promise<void> => {
		await expect
			.poll(() =>
				page.evaluate(
					({ phaseStart, rootId, relativePath }) => {
						const testWindow = window as unknown as Window & {
							__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
						};
						return testWindow.__PLAIN_TEST_TAURI_CALLS__
							.slice(phaseStart)
							.some(({ command, args }) => {
								if (command !== "workspace_read_dir") {
									return false;
								}
								const request = args.request as
									{ rootId?: unknown; relativePath?: unknown } | undefined;
								return (
									request?.rootId === rootId &&
									request.relativePath === relativePath
								);
							});
					},
					{ phaseStart, rootId, relativePath },
				),
			)
			.toBe(true);
	};

	const consumeDeleteFailureToast = async (): Promise<void> => {
		const toasts = page.locator(".notifications-toasts .notification-toast");
		await expect(toasts).toHaveCount(1);
		const toast = toasts.first();
		await expect(toast).toContainText(deleteMessage);
		await expect(
			toast.getByRole("button", { name: "Retry", exact: true }),
		).toHaveCount(0);
		const text = await toast.innerText();
		expect(text).not.toContain("entryRetained");
		expect(text).not.toContain("entryPartiallyDeleted");
		expect(text).not.toContain("deleteFailed");
		expect(text).not.toContain("removedEntries");
		expect(text).not.toContain(nativeRootId);
		expect(text).not.toContain(nativeSecondaryRootId);
		expect(text).not.toMatch(/ENTRY_/u);
		expect(text).not.toMatch(/(?:\/Users\/|[A-Za-z]:\\|\\\\)/u);
		// The coordinator owns this failure surface directly so the context menu
		// and keyboard paths cannot diverge after the confirmation settles.
		await expect(toast.locator(".codicon-error")).toHaveCount(1);
		await expect(toast.locator(".codicon-warning")).toHaveCount(0);
		await toast.hover();
		await toast
			.getByRole("button", {
				name: /^Clear Notification(?: \(.+\))?$/u,
			})
			.click();
		await expect(toasts).toHaveCount(0);
	};

	// Use the dedicated permanent-delete keybinding now that the ordinary
	// Explorer delete path advertises and uses system Trash.
	const deletePermanently = async (
		item: Locator,
		name: string,
	): Promise<number> => {
		const phaseStart = await currentCallCount();
		await item.click();
		const key = pressExplorerPermanentDeleteKey(page);
		const dialog = page.locator(".monaco-dialog-box");
		await expect(dialog).toHaveCount(1);
		await expect(dialog).toContainText(`永久删除“${name}”？`);
		await expect(dialog).toContainText("此操作永久且不可撤销");
		await expect(dialog).toContainText("不会移入废纸篓");
		await dialog.getByRole("button", { name: "永久删除", exact: true }).click();
		await key;
		await expect(page.locator(".monaco-dialog-box")).toHaveCount(0);
		await consumeDeleteFailureToast();
		return phaseStart;
	};

	const retainedTarget = itemAtLevel("delete-retained.txt", 2);
	await expect(retainedTarget).toHaveCount(1);
	const retainedPhaseStart = await deletePermanently(
		retainedTarget,
		"delete-retained.txt",
	);
	await expect(itemAtLevel("delete-retained.txt", 2)).toHaveCount(1);
	await expectRootRefresh(retainedPhaseStart, nativeRootId, "");

	const partialTarget = itemAtLevel("delete-partial", 2);
	await expandDirectory(partialTarget);
	await expect(itemAtLevel("removed.txt", 3)).toHaveCount(1);
	await expect(itemAtLevel("kept.txt", 3)).toHaveCount(1);
	const partialPhaseStart = await deletePermanently(
		partialTarget,
		"delete-partial",
	);
	await expect(itemAtLevel("delete-partial", 2)).toHaveCount(1);
	// Assert the root-level auto-refresh before any further tree interaction,
	// so this is unambiguously the coordinator's own post-failure refresh and
	// not something the test induced: probed against this fixture, the root
	// ("") read_dir lands here even with zero interaction since
	// consumeDeleteFailureToast(). The already-expanded "delete-partial" child
	// is a different story -- probed the same way, its read_dir does *not*
	// land without a further explorer interaction, so re-reading it here
	// would silently start relying on the expandDirectory click below for
	// evidence instead of on automatic refresh. That assertion is therefore
	// made only after expandDirectory, where it is honestly attributable to
	// reopening the directory rather than to the coordinator's refresh.
	await expectRootRefresh(partialPhaseStart, nativeSecondaryRootId, "");
	await expandDirectory(itemAtLevel("delete-partial", 2));
	await expectRootRefresh(
		partialPhaseStart,
		nativeSecondaryRootId,
		"delete-partial",
	);
	await expect(itemAtLevel("kept.txt", 3)).toHaveCount(1);
	await expect(itemAtLevel("removed.txt", 3)).toHaveCount(0);

	const evidence = await page.evaluate(
		({ callStart, mutationCommands }) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			return testWindow.__PLAIN_TEST_TAURI_CALLS__
				.slice(callStart)
				.filter(({ command }) => mutationCommands.includes(command));
		},
		{
			callStart,
			mutationCommands: nativeMutationCommands as readonly string[],
		},
	);
	expect(evidence.map(({ command }) => command)).toEqual([
		"workspace_prepare_delete",
		"workspace_begin_delete",
		"workspace_commit_delete_entry",
		"workspace_cancel_delete",
		"workspace_prepare_delete",
		"workspace_begin_delete",
		"workspace_commit_delete_entry",
		"workspace_cancel_delete",
	]);

	const idPattern =
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

	const retainedPrepare = evidence[0]!.args.request as {
		readonly entries: readonly {
			readonly rootId: string;
			readonly relativePath: string;
			readonly recursive: boolean;
		}[];
	};
	expect(retainedPrepare).toEqual({
		entries: [
			{
				rootId: nativeRootId,
				relativePath: "delete-retained.txt",
				recursive: true,
			},
		],
	});
	const retainedBegin = evidence[1]!.args.request as {
		readonly confirmationId: string;
	};
	const retainedCommit = evidence[2]!.args.request as {
		readonly confirmationId: string;
		readonly entryId: string;
		readonly rootId: string;
		readonly relativePath: string;
		readonly recursive: boolean;
	};
	const retainedCancel = evidence[3]!.args.request as {
		readonly confirmationId: string;
	};
	expect(retainedBegin.confirmationId).toMatch(idPattern);
	expect(retainedCommit).toMatchObject({
		confirmationId: retainedBegin.confirmationId,
		entryId: expect.stringMatching(idPattern),
		rootId: nativeRootId,
		relativePath: "delete-retained.txt",
		recursive: true,
	});
	expect(retainedCommit.entryId).not.toBe(retainedCommit.confirmationId);
	expect(retainedCancel.confirmationId).toBe(retainedBegin.confirmationId);

	const partialPrepare = evidence[4]!.args.request as {
		readonly entries: readonly {
			readonly rootId: string;
			readonly relativePath: string;
			readonly recursive: boolean;
		}[];
	};
	expect(partialPrepare).toEqual({
		entries: [
			{
				rootId: nativeSecondaryRootId,
				relativePath: "delete-partial",
				recursive: true,
			},
		],
	});
	const partialBegin = evidence[5]!.args.request as {
		readonly confirmationId: string;
	};
	const partialCommit = evidence[6]!.args.request as {
		readonly confirmationId: string;
		readonly entryId: string;
		readonly rootId: string;
		readonly relativePath: string;
		readonly recursive: boolean;
	};
	const partialCancel = evidence[7]!.args.request as {
		readonly confirmationId: string;
	};
	expect(partialBegin.confirmationId).toMatch(idPattern);
	expect(partialCommit).toMatchObject({
		confirmationId: partialBegin.confirmationId,
		entryId: expect.stringMatching(idPattern),
		rootId: nativeSecondaryRootId,
		relativePath: "delete-partial",
		recursive: true,
	});
	expect(partialCommit.entryId).not.toBe(partialCommit.confirmationId);
	expect(partialCancel.confirmationId).toBe(partialBegin.confirmationId);
	expect(partialBegin.confirmationId).not.toBe(retainedBegin.confirmationId);

	await expect(
		page.locator(".notifications-toasts .notification-toast"),
	).toHaveCount(0);
	await expect(page.locator(".monaco-dialog-box")).toHaveCount(0);
	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	// Each phase emits the raw BulkEditService diagnostic followed by the
	// coordinator-owned, sanitized Error notification mirrored by
	// NotificationsAlerts.
	expect(consoleErrors).toHaveLength(4);
	expect(consoleErrors[0]).toContain("Unavailable");
	expect(consoleErrors[0]).toContain("The workspace is unavailable.");
	for (const diagnostic of consoleErrors) {
		expect(diagnostic).not.toContain("entryRetained");
		expect(diagnostic).not.toContain("entryPartiallyDeleted");
		expect(diagnostic).not.toContain("deleteFailed");
		expect(diagnostic).not.toContain("removedEntries");
		expect(diagnostic).not.toContain(nativeRootId);
		expect(diagnostic).not.toContain(nativeSecondaryRootId);
	}
	expect(consoleErrors[1]).toBe(deleteMessage);
	expect(consoleErrors[1]).not.toMatch(/(?:\/Users\/|[A-Za-z]:\\|\\\\)/u);
	expect(consoleErrors[2]).toContain("Unavailable");
	expect(consoleErrors[2]).toContain("The workspace is unavailable.");
	expect(consoleErrors[3]).toBe(deleteMessage);
	expect(consoleErrors[3]).not.toMatch(/(?:\/Users\/|[A-Za-z]:\\|\\\\)/u);
});

test("edits both roots and routes cross-root copy and move through all-true IPC", async ({
	page,
}) => {
	const errors: string[] = [];
	const nativeDialogs: string[] = [];
	await installMultiRootNativeIpcMock(page, "supported");
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
		origin: "http://127.0.0.1:1420",
	});
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});

	const explorer = await openNativeWorkspaceExplorer(page);
	await executePaletteCommand(
		page,
		"Add Folder to Workspace",
		"Workspaces: Add Folder to Workspace...",
	);
	const primaryRoot = explorer.getByRole("treeitem", {
		name: "plain-workspace",
		exact: true,
	});
	const secondaryRoot = explorer.getByRole("treeitem", {
		name: "plain-library",
		exact: true,
	});
	await expect(primaryRoot).toHaveCount(1);
	await expect(secondaryRoot).toHaveCount(1);
	const expandDirectory = async (directory: Locator): Promise<void> => {
		if ((await directory.getAttribute("aria-expanded")) !== "true") {
			await directory.click();
			await page.keyboard.press("ArrowRight");
		}
		await expect(directory).toHaveAttribute("aria-expanded", "true");
	};
	await expandDirectory(primaryRoot);
	await expandDirectory(secondaryRoot);

	const readme = explorer.getByRole("treeitem", {
		name: "README.md",
		exact: true,
	});
	const notes = explorer.getByRole("treeitem", {
		name: "notes.txt",
		exact: true,
	});
	const saveExplorerFile = async (
		entry: Locator,
		initialText: string,
		savedContent: string,
		savedMarker: string,
		expectedWriteCount: number,
	): Promise<void> => {
		await entry.dblclick();
		const editor = page.getByRole("code").filter({ hasText: initialText });
		await expect(editor).toBeVisible();
		await page
			.locator(".monaco-editor .view-line")
			.filter({ hasText: initialText })
			.click();
		await page.keyboard.press("ControlOrMeta+A");
		await page.keyboard.type(savedContent);
		const activeTab = page.locator(".tabs-container .tab.active");
		await page.keyboard.press("ControlOrMeta+S");
		await expect
			.poll(() =>
				page.evaluate(() => {
					const testWindow = window as unknown as Window & {
						__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
					};
					return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
						({ command }) => command === "workspace_write_file",
					).length;
				}),
			)
			.toBe(expectedWriteCount);
		await expect(activeTab).not.toHaveClass(/dirty/);
		await expect(
			page.getByRole("code").filter({ hasText: savedMarker }),
		).toBeVisible();
	};
	const primarySavedContent =
		"# Primary workspace\n\nEdited in the primary root.\n";
	await saveExplorerFile(
		readme,
		"# Primary workspace",
		primarySavedContent,
		"Edited in the primary root.",
		1,
	);
	const secondarySavedContent =
		"Secondary workspace\nEdited in the secondary root.\n";
	await saveExplorerFile(
		notes,
		"Secondary workspace",
		secondarySavedContent,
		"Edited in the secondary root.",
		2,
	);

	const copySource = explorer.getByRole("treeitem", {
		name: "copy-source.txt",
		exact: true,
	});
	const packages = explorer.getByRole("treeitem", {
		name: "packages",
		exact: true,
	});
	await activateExplorerContextAction(page, copySource, "Copy");
	await activateExplorerContextAction(page, packages, "Paste");
	await expect
		.poll(() =>
			page.evaluate(() => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				};
				return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
					({ command }) => command === "workspace_copy",
				).length;
			}),
		)
		.toBe(1);
	await expandDirectory(packages);
	const copiedTarget = explorer
		.locator('[role="treeitem"][aria-level="3"]')
		.filter({ hasText: "copy-source.txt" });
	await expect(copiedTarget).toHaveCount(1);
	await expect(
		explorer
			.locator('[role="treeitem"][aria-level="2"]')
			.filter({ hasText: "copy-source.txt" }),
	).toHaveCount(1);
	await copiedTarget.dblclick();
	await expect(
		page.getByRole("code").filter({ hasText: "Copy across roots." }),
	).toBeVisible();

	const moveSource = explorer.getByRole("treeitem", {
		name: "move-source.txt",
		exact: true,
	});
	const src = explorer.getByRole("treeitem", { name: "src", exact: true });
	const renameAction = await explorerContextAction(
		page,
		moveSource,
		"Rename...",
	);
	await expect(renameAction).not.toHaveAttribute("aria-disabled", "true");
	await page.keyboard.press("Escape");
	await expect(page.locator(".context-view")).toBeHidden();
	await moveSource.click();
	await expect(moveSource).toHaveAttribute("aria-selected", "true");
	await page.keyboard.press("ControlOrMeta+X");
	await expect(moveSource.locator(".explorer-item.cut")).toHaveCount(1);
	await activateExplorerContextAction(page, src, "Paste");
	await expect
		.poll(() =>
			page.evaluate(() => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				};
				return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
					({ command }) => command === "workspace_move",
				).length;
			}),
		)
		.toBe(1);
	await expandDirectory(src);
	const movedTarget = explorer
		.locator('[role="treeitem"][aria-level="3"]')
		.filter({ hasText: "move-source.txt" });
	await expect(movedTarget).toHaveCount(1);
	await expect(
		explorer
			.locator('[role="treeitem"][aria-level="2"]')
			.filter({ hasText: "move-source.txt" }),
	).toHaveCount(0);
	await movedTarget.dblclick();
	await expect(
		page.getByRole("code").filter({ hasText: "Move across roots." }),
	).toBeVisible();

	const evidence = await page.evaluate(
		(mutationCommands) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_MULTI_ROOT_VERSION_TRANSITIONS__: TestWorkspaceVersionTransition[];
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			return {
				capabilities: testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
					({ command }) => command === "workspace_capabilities",
				),
				mutations: testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(({ command }) =>
					mutationCommands.includes(command),
				),
				versionTransitions: structuredClone(
					testWindow.__PLAIN_TEST_MULTI_ROOT_VERSION_TRANSITIONS__,
				),
			};
		},
		nativeMutationCommands as readonly string[],
	);
	expect(evidence.capabilities).toEqual([
		{ command: "workspace_capabilities", args: { request: {} } },
	]);
	expect(evidence.mutations.map(({ command }) => command)).toEqual([
		"workspace_write_file",
		"workspace_write_file",
		"workspace_copy",
		"workspace_move",
	]);
	const [primaryWrite, secondaryWrite, copy, move] = evidence.mutations;
	for (const write of [primaryWrite, secondaryWrite]) {
		expect(Reflect.ownKeys(write!.args)).toEqual([
			"rawHex",
			"request",
			"contentHex",
		]);
		expect(write!.args.rawHex).toEqual(expect.stringMatching(/^504c5731/u));
		expect(Reflect.ownKeys(write!.args.request as object)).toEqual([
			"rootId",
			"relativePath",
			"expectedVersion",
		]);
	}
	expect(primaryWrite!.args.request).toEqual({
		rootId: nativeRootId,
		relativePath: "README.md",
		expectedVersion: expect.stringMatching(/^wv1:[0-9a-f]{64}$/u),
	});
	expect(primaryWrite!.args.contentHex).toBe(
		[...new TextEncoder().encode(primarySavedContent)]
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join(""),
	);
	expect(secondaryWrite!.args.request).toEqual({
		rootId: nativeSecondaryRootId,
		relativePath: "notes.txt",
		expectedVersion: expect.stringMatching(/^wv1:[0-9a-f]{64}$/u),
	});
	expect(secondaryWrite!.args.contentHex).toBe(
		[...new TextEncoder().encode(secondarySavedContent)]
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join(""),
	);
	expect(
		(primaryWrite!.args.request as { expectedVersion: string }).expectedVersion,
	).not.toBe(
		(secondaryWrite!.args.request as { expectedVersion: string })
			.expectedVersion,
	);
	expect(copy!.args).toEqual({
		request: {
			sourceRootId: nativeRootId,
			sourcePath: "copy-source.txt",
			targetRootId: nativeSecondaryRootId,
			targetPath: "packages/copy-source.txt",
		},
	});
	expect(move!.args).toEqual({
		request: {
			sourceRootId: nativeSecondaryRootId,
			sourcePath: "move-source.txt",
			targetRootId: nativeRootId,
			targetPath: "src/move-source.txt",
		},
	});
	expect(evidence.versionTransitions).toEqual([
		{
			command: "workspace_copy",
			sourceRootId: nativeRootId,
			sourcePath: "copy-source.txt",
			sourceVersion: expect.stringMatching(/^wv1:[0-9a-f]{64}$/u),
			targetRootId: nativeSecondaryRootId,
			targetPath: "packages/copy-source.txt",
			targetVersion: expect.stringMatching(/^wv1:[0-9a-f]{64}$/u),
		},
		{
			command: "workspace_move",
			sourceRootId: nativeSecondaryRootId,
			sourcePath: "move-source.txt",
			sourceVersion: expect.stringMatching(/^wv1:[0-9a-f]{64}$/u),
			targetRootId: nativeRootId,
			targetPath: "src/move-source.txt",
			targetVersion: expect.stringMatching(/^wv1:[0-9a-f]{64}$/u),
		},
	]);
	for (const transition of evidence.versionTransitions) {
		expect(transition.targetVersion).not.toBe(transition.sourceVersion);
	}
	await expect(
		page.locator(".notifications-toasts .notification-toast"),
	).toHaveCount(0);
	expect(nativeDialogs).toEqual([]);
	expect(errors).toEqual([]);
});

for (const rawReadTransport of ["arrayBuffer", "numberArray"] as const) {
	test(`projects a selected folder into Explorer and opens files via ${rawReadTransport}`, async ({
		page,
	}) => {
		const errors: string[] = [];
		await installNativeIpcMock(page, rawReadTransport);
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});

		await page.goto("/");
		await expect(page.locator("body")).toHaveAttribute(
			"data-plain-ready",
			"true",
			{ timeout: 60_000 },
		);
		await expect(
			page.getByRole("treeitem", { name: "README.md", exact: true }),
		).toHaveCount(0);
		await executePaletteCommand(page, "Open Folder", "File: Open Folder...");
		await page.getByRole("tab", { name: /^Explorer / }).click();

		const explorer = page.getByRole("tree", { name: "Files Explorer" });
		await expect(explorer).toBeVisible();
		const readme = explorer.getByRole("treeitem", {
			name: "README.md",
			exact: true,
		});
		await expect(readme).toHaveCount(1);
		await readme.dblclick();
		await expect(
			page.getByRole("tab", { name: /^README\.md(?:,.*)?$/ }),
		).toBeVisible();
		await expect(
			page.getByRole("code").filter({ hasText: "Read-only Explorer fixture." }),
		).toBeVisible();

		const src = explorer.getByRole("treeitem", { name: "src", exact: true });
		await src.click();
		await page.keyboard.press("ArrowRight");
		await expect(src).toHaveAttribute("aria-expanded", "true");
		const main = explorer.getByRole("treeitem", {
			name: "main.ts",
			exact: true,
		});
		await expect(main).toHaveCount(1);
		await main.dblclick();
		await expect(
			page.getByRole("tab", { name: /^main\.ts(?:,.*)?$/ }),
		).toBeVisible();
		await expect(
			page.getByRole("code").filter({ hasText: "export const plain = true;" }),
		).toBeVisible();

		await executePaletteCommand(page, "Open Folder", "File: Open Folder...");
		await expectPaletteCommandHidden(
			page,
			"Open Workspace from File",
			"Workspaces: Open Workspace from File...",
		);
		await expectPaletteCommandHidden(
			page,
			"Save Workspace As",
			"Workspaces: Save Workspace As...",
		);
		await expectPaletteCommandHidden(
			page,
			"Duplicate As Workspace",
			"Workspaces: Duplicate As Workspace in New Window",
		);

		await expect(
			page.locator(".notifications-toasts .notification-toast"),
		).toHaveCount(0);
		const bootstrapInvocations = await page.evaluate(() => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			const workspaceInvocations = testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
				({ command }) => command.startsWith("workspace_"),
			);
			return {
				capabilities: workspaceInvocations.filter(
					({ command }) => command === "workspace_capabilities",
				),
				firstTwo: workspaceInvocations.slice(0, 2),
			};
		});
		expect(bootstrapInvocations.capabilities).toEqual([
			{ command: "workspace_capabilities", args: { request: {} } },
		]);
		expect(bootstrapInvocations.firstTwo).toEqual([
			{ command: "workspace_capabilities", args: { request: {} } },
			{ command: "workspace_snapshot", args: { request: {} } },
		]);
		const workspaceInvocations = await page.evaluate(() => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
				({ command }) => command === "workspace_pick_roots",
			);
		});
		expect(workspaceInvocations).toEqual([
			{
				command: "workspace_pick_roots",
				args: { request: { mode: "replace" } },
			},
			{
				command: "workspace_pick_roots",
				args: { request: { mode: "replace" } },
			},
		]);
		const fileReadInvocations = await page.evaluate(() => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
				({ command }) => command === "workspace_read_file",
			);
		});
		const fileReadRequests = fileReadInvocations.map(
			({ args }) =>
				args.request as {
					readonly rootId: string;
					readonly relativePath: string;
				},
		);
		expect(fileReadRequests.map(({ relativePath }) => relativePath)).toEqual(
			expect.arrayContaining(["README.md", "src/main.ts"]),
		);
		expect(
			fileReadRequests.every(({ rootId }) => rootId === nativeRootId),
		).toBe(true);
		expect(errors).toEqual([]);
	});
}

test("refreshes Explorer after watcher wakes and after a lost wake timer pull", async ({
	page,
}) => {
	const errors: string[] = [];
	await installNativeIpcMock(page, "arrayBuffer");
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});

	const explorer = await openNativeWorkspaceExplorer(page);
	await expect
		.poll(() =>
			page.evaluate(() => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				};
				return testWindow.__PLAIN_TEST_TAURI_CALLS__.some(
					({ command, args }) =>
						command === "plugin:event|listen" &&
						args.event === "plain://workspace-watch-wake",
				);
			}),
		)
		.toBe(true);

	await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_EXTERNAL_CREATE__(name: string, emitWake: boolean): void;
		};
		testWindow.__PLAIN_TEST_EXTERNAL_CREATE__("external-wake.txt", true);
	});
	await expect(
		explorer.getByRole("treeitem", {
			name: "external-wake.txt",
			exact: true,
		}),
	).toHaveCount(1, { timeout: 5_000 });

	await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_EXTERNAL_CREATE__(name: string, emitWake: boolean): void;
		};
		testWindow.__PLAIN_TEST_EXTERNAL_CREATE__("external-timer.txt", false);
	});
	await expect(
		explorer.getByRole("treeitem", {
			name: "external-timer.txt",
			exact: true,
		}),
	).toHaveCount(1, { timeout: 7_000 });

	const watcherRequests = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		return testWindow.__PLAIN_TEST_TAURI_CALLS__
			.filter(({ command }) => command === "workspace_watch_sync")
			.map(({ args }) => args.request);
	});
	expect(watcherRequests.length).toBeGreaterThanOrEqual(5);
	for (const request of watcherRequests) {
		const roots = (
			request as {
				roots?: readonly {
					rootId?: unknown;
					acknowledgedGeneration?: unknown;
				}[];
			}
		).roots;
		expect(roots).toHaveLength(1);
		expect(roots?.[0]?.rootId).toBe(nativeRootId);
		const acknowledgedGeneration = roots?.[0]?.acknowledgedGeneration;
		expect(
			acknowledgedGeneration === null ||
				(typeof acknowledgedGeneration === "number" &&
					Number.isInteger(acknowledgedGeneration) &&
					acknowledgedGeneration > 0),
		).toBe(true);
		expect(JSON.stringify(request)).not.toMatch(
			/(?:relative|canonical|native)?path/iu,
		);
	}
	expect(errors).toEqual([]);
});

test("routes all-five workspace CRUD, save, rename and permanent delete through native IPC", async ({
	page,
}) => {
	const errors: string[] = [];
	const nativeDialogs: string[] = [];
	await installNativeIpcMock(page, "arrayBuffer", "supported");
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
		origin: "http://127.0.0.1:1420",
	});
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});

	const explorer = await openNativeWorkspaceExplorer(page);
	const readme = explorer.getByRole("treeitem", {
		name: "README.md",
		exact: true,
	});
	await readme.dblclick();
	const editor = page
		.getByRole("code")
		.filter({ hasText: "Read-only Explorer fixture." });
	await expect(editor).toBeVisible();
	await page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "Read-only Explorer fixture." })
		.click();
	const savedContent = "# Native workspace\n\nSaved by Browser E2E.\n";
	await page.keyboard.press("ControlOrMeta+A");
	await page.keyboard.type(savedContent);
	const activeTab = page.locator(".tabs-container .tab.active");
	await page.keyboard.press("ControlOrMeta+S");
	await expect
		.poll(async () =>
			page.evaluate(() => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				};
				return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
					({ command }) => command === "workspace_write_file",
				).length;
			}),
		)
		.toBe(1);
	await expect(activeTab).not.toHaveClass(/dirty/);
	await expect(
		page.getByRole("code").filter({ hasText: "Saved by Browser E2E." }),
	).toBeVisible();

	const src = explorer.getByRole("treeitem", { name: "src", exact: true });
	await src.click();
	await page.keyboard.press("ArrowRight");
	await expect(src).toHaveAttribute("aria-expanded", "true");

	await page
		.getByRole("button", { name: "New Folder...", exact: true })
		.click();
	await finishExplorerNameInput(page, "scratch");
	const scratch = explorer.getByRole("treeitem", {
		name: "scratch",
		exact: true,
	});
	await expect(scratch).toBeVisible();

	await src.click();
	await page.getByRole("button", { name: "New File...", exact: true }).click();
	await finishExplorerNameInput(page, "draft.txt");
	const draft = explorer.getByRole("treeitem", {
		name: "draft.txt",
		exact: true,
	});
	await expect(draft).toBeVisible();

	const main = explorer.getByRole("treeitem", {
		name: "main.ts",
		exact: true,
	});
	await main.click();
	await page.keyboard.press("ControlOrMeta+C");
	await scratch.click();
	await page.keyboard.press("ControlOrMeta+V");
	await expect
		.poll(async () =>
			page.evaluate(() => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				};
				return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
					({ command }) => command === "workspace_copy",
				).length;
			}),
		)
		.toBe(1);
	await scratch.click();
	await page.keyboard.press("ArrowRight");
	await expect(scratch).toHaveAttribute("aria-expanded", "true");
	await expect(
		explorer
			.locator('[role="treeitem"][aria-level="3"]')
			.filter({ hasText: "main.ts" }),
	).toHaveCount(1);

	await scratch.click();
	await pressExplorerRenameKey(page);
	await finishExplorerNameInput(page, "renamed");
	await expect(scratch).toHaveCount(0);
	const renamed = explorer.getByRole("treeitem", {
		name: "renamed",
		exact: true,
	});
	await expect(renamed).toBeVisible();

	await renamed.click();
	const cancelDeleteKey = pressExplorerPermanentDeleteKey(page);
	const permanentDeleteDialog = page.getByRole("dialog");
	await expect(permanentDeleteDialog).toBeVisible();
	await expect(permanentDeleteDialog).toContainText("永久删除“renamed”？");
	await expect(permanentDeleteDialog).toContainText("此操作永久且不可撤销");
	await expect(permanentDeleteDialog).toContainText("不会移入废纸篓");
	await expect(
		permanentDeleteDialog.getByRole("button", {
			name: "永久删除",
			exact: true,
		}),
	).toBeVisible();
	await permanentDeleteDialog
		.getByRole("button", { name: "Cancel", exact: true })
		.click();
	await cancelDeleteKey;
	await expect(permanentDeleteDialog).toHaveCount(0);
	await expect(renamed).toBeVisible();
	await expect
		.poll(async () =>
			page.evaluate(
				(commands) => {
					const testWindow = window as unknown as Window & {
						__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
					};
					return testWindow.__PLAIN_TEST_TAURI_CALLS__
						.filter(({ command }) => commands.includes(command))
						.map(({ command }) => command);
				},
				nativeDeleteCommands as readonly string[],
			),
		)
		.toEqual(["workspace_prepare_delete", "workspace_cancel_delete"]);

	await renamed.click();
	const confirmDeleteKey = pressExplorerPermanentDeleteKey(page);
	await expect(permanentDeleteDialog).toBeVisible();
	await permanentDeleteDialog
		.getByRole("button", { name: "永久删除", exact: true })
		.click();
	await confirmDeleteKey;
	await expect(permanentDeleteDialog).toHaveCount(0);
	await expect(renamed).toHaveCount(0);

	const mutations = await page.evaluate(
		(commands) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(({ command }) =>
				commands.includes(command),
			);
		},
		nativeMutationCommands as readonly string[],
	);
	expect(mutations.map(({ command }) => command)).toEqual([
		"workspace_write_file",
		"workspace_create_directory",
		"workspace_create_file",
		"workspace_copy",
		"workspace_rename",
		"workspace_prepare_delete",
		"workspace_cancel_delete",
		"workspace_prepare_delete",
		"workspace_begin_delete",
		"workspace_commit_delete_entry",
	]);
	const write = mutations[0]!.args;
	expect(write.request).toMatchObject({
		rootId: nativeRootId,
		relativePath: "README.md",
		expectedVersion: expect.stringMatching(/^wv1:[0-9a-f]{64}$/),
	});
	expect(write.contentHex).toBe(
		[...new TextEncoder().encode(savedContent)]
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join(""),
	);
	expect(mutations[1]!.args).toEqual({
		request: { rootId: nativeRootId, relativePath: "src/scratch" },
	});
	expect(mutations[2]!.args).toEqual({
		request: { rootId: nativeRootId, relativePath: "src/draft.txt" },
	});
	expect(mutations[3]!.args).toEqual({
		request: {
			sourceRootId: nativeRootId,
			sourcePath: "src/main.ts",
			targetRootId: nativeRootId,
			targetPath: "src/scratch/main.ts",
		},
	});
	expect(mutations[4]!.args).toEqual({
		request: {
			rootId: nativeRootId,
			sourcePath: "src/scratch",
			targetPath: "src/renamed",
		},
	});
	for (const prepareMutation of [mutations[5], mutations[7]]) {
		const prepared = prepareMutation!.args.request as {
			readonly entries: readonly {
				readonly rootId: string;
				readonly relativePath: string;
				readonly recursive: boolean;
			}[];
		};
		expect(prepared).toEqual({
			entries: [
				{
					rootId: nativeRootId,
					relativePath: "src/renamed",
					recursive: true,
				},
			],
		});
	}
	const cancel = mutations[6]!.args.request as {
		readonly confirmationId: string;
	};
	const begin = mutations[8]!.args.request as {
		readonly confirmationId: string;
	};
	const commit = mutations[9]!.args.request as {
		readonly confirmationId: string;
		readonly entryId: string;
		readonly rootId: string;
		readonly relativePath: string;
		readonly recursive: boolean;
	};
	expect(begin.confirmationId).toMatch(
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	);
	expect(cancel.confirmationId).toMatch(
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	);
	expect(cancel.confirmationId).not.toBe(begin.confirmationId);
	expect(commit).toMatchObject({
		confirmationId: begin.confirmationId,
		entryId: expect.stringMatching(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		),
		rootId: nativeRootId,
		relativePath: "src/renamed",
		recursive: true,
	});
	expect(commit.entryId).not.toBe(commit.confirmationId);
	await expect(
		page.locator(".notifications-toasts .notification-toast"),
	).toHaveCount(0);
	expect(nativeDialogs).toEqual([]);
	expect(errors).toEqual([]);
});

test("moves ordinary Explorer deletes through confirmed system Trash without permanent fallback", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const nativeDialogs: string[] = [];
	await installTrashNativeIpcMock(
		page,
		[{ status: "entryRetained", reason: "trashFailed" }, { status: "trashed" }],
		1,
	);
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});

	const explorer = await openNativeWorkspaceExplorer(page);
	const item = (name: string): Locator =>
		explorer.getByRole("treeitem", { name, exact: true });
	const trashDialog = page.locator(".monaco-dialog-box");
	const invokeTrash = async (name: string, confirm: boolean): Promise<void> => {
		const target = item(name);
		await expect(target).toHaveCount(1);
		await target.click();
		const key = pressExplorerTrashKey(page);
		await expect(trashDialog).toBeVisible();
		await expect(trashDialog).toContainText(`将“${name}”移到废纸篓？`);
		await expect(trashDialog).toContainText("所选项目将移到系统废纸篓");
		await expect(trashDialog).toContainText("可在废纸篓中恢复");
		await expect(trashDialog).not.toContainText("永久且不可撤销");
		if (confirm) {
			await trashDialog
				.getByRole("button", { name: "移到废纸篓", exact: true })
				.click();
		} else {
			await trashDialog
				.getByRole("button", { name: "Cancel", exact: true })
				.click();
		}
		await key;
		await expect(trashDialog).toHaveCount(0);
	};

	await invokeTrash("trash-cancel.txt", false);
	await expect(item("trash-cancel.txt")).toHaveCount(1);
	const toast = page.locator(".notifications-toasts .notification-toast");

	await invokeTrash("trash-changed.txt", true);
	await expect(item("trash-changed.txt")).toHaveCount(1);
	await expect(toast).toHaveCount(1);
	await expect(toast).toContainText(
		"A selected workspace entry changed before it could be moved to the system Trash.",
	);
	let toastText = await toast.innerText();
	expect(toastText).not.toContain("WORKSPACE_TRASH_BATCH_CHANGED");
	expect(toastText).not.toContain(nativeRootId);
	expect(toastText).not.toMatch(/(?:\/Users\/|[A-Za-z]:\\|\\\\)/u);
	await toast.hover();
	await toast
		.getByRole("button", { name: /^Clear Notification(?: \(.+\))?$/u })
		.click();
	await expect(toast).toHaveCount(0);

	await invokeTrash("trash-retained.txt", true);
	await expect(item("trash-retained.txt")).toHaveCount(1);
	await expect(toast).toHaveCount(1);
	await expect(toast).toContainText(
		"The system Trash batch stopped before an entry could be moved.",
	);
	toastText = await toast.innerText();
	expect(toastText).not.toContain("trashFailed");
	expect(toastText).not.toContain(nativeRootId);
	expect(toastText).not.toMatch(/(?:\/Users\/|[A-Za-z]:\\|\\\\)/u);
	await toast.hover();
	await toast
		.getByRole("button", { name: /^Clear Notification(?: \(.+\))?$/u })
		.click();
	await expect(toast).toHaveCount(0);

	await invokeTrash("trash-success.txt", true);
	await expect(item("trash-success.txt")).toHaveCount(0);

	const evidence = await page.evaluate(
		({ trashCommands, deleteCommands }) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(({ command }) =>
				[...trashCommands, ...deleteCommands].includes(command),
			);
		},
		{
			trashCommands: nativeTrashCommands as readonly string[],
			deleteCommands: nativeDeleteCommands as readonly string[],
		},
	);
	expect(evidence.map(({ command }) => command)).toEqual([
		"workspace_prepare_trash",
		"workspace_cancel_trash",
		"workspace_prepare_trash",
		"workspace_begin_trash",
		"workspace_cancel_trash",
		"workspace_prepare_trash",
		"workspace_begin_trash",
		"workspace_commit_trash_entry",
		"workspace_cancel_trash",
		"workspace_prepare_trash",
		"workspace_begin_trash",
		"workspace_commit_trash_entry",
	]);
	expect(
		evidence.some(({ command }) =>
			(nativeDeleteCommands as readonly string[]).includes(command),
		),
	).toBe(false);
	for (const invocation of evidence) {
		const wire = JSON.stringify(invocation.args);
		expect(wire).not.toMatch(/nativePath|useTrash|recursive/u);
	}
	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
});

test("keeps the entire provider readonly when one platform capability is false", async ({
	page,
}) => {
	await installNativeIpcMock(page, "arrayBuffer", "readonly");
	const explorer = await openNativeWorkspaceExplorer(page);
	const readme = explorer.getByRole("treeitem", {
		name: "README.md",
		exact: true,
	});
	await readme.dblclick();
	const editor = page
		.getByRole("code")
		.filter({ hasText: "Read-only Explorer fixture." });
	await expect(editor).toBeVisible();
	const activeTab = page.locator(".tabs-container .tab.active");
	await expect(activeTab).not.toHaveClass(/dirty/);
	await page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "Read-only Explorer fixture." })
		.click();
	await page.keyboard.press("ControlOrMeta+A");
	await page.keyboard.type("This write must stay blocked.");
	await page.keyboard.press("ControlOrMeta+S");
	await expect(activeTab).not.toHaveClass(/dirty/);
	await expect(editor).toContainText("Read-only Explorer fixture.");

	const src = explorer.getByRole("treeitem", { name: "src", exact: true });
	await expect(
		page.getByRole("button", { name: "New File...", exact: true }),
	).toHaveAttribute("aria-disabled", "true");
	await expect(
		page.getByRole("button", { name: "New Folder...", exact: true }),
	).toHaveAttribute("aria-disabled", "true");
	const rename = await explorerContextAction(page, src, "Rename...");
	await expect(rename).toHaveAttribute("aria-disabled", "true");
	await page.keyboard.press("Escape");

	const dialogs: string[] = [];
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const consoleWarnings: string[] = [];
	const onDialog = (dialog: Dialog): void => {
		dialogs.push(dialog.message());
		void dialog.dismiss();
	};
	const onPageError = (error: Error): void => {
		pageErrors.push(error.message);
	};
	const onConsole = (message: ConsoleMessage): void => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		} else if (message.type() === "warning") {
			consoleWarnings.push(message.text());
		}
	};
	page.on("dialog", onDialog);
	page.on("pageerror", onPageError);
	page.on("console", onConsole);
	try {
		await src.click();
		await pressExplorerPermanentDeleteKey(page);
		const warningToast = page
			.locator(".notifications-toasts .notification-toast")
			.filter({ hasText: "The workspace delete selection is invalid." });
		await expect(warningToast).toHaveCount(1);
		await expect(warningToast).toContainText(
			"The workspace delete selection is invalid.",
		);
		await expect(page.getByRole("dialog")).toHaveCount(1);
		await warningToast.hover();
		await warningToast
			.getByRole("button", {
				name: /^Clear Notification(?: \(.+\))?$/u,
			})
			.click();
		await expect(warningToast).toHaveCount(0);
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await expect
			.poll(async () =>
				page.evaluate(
					(commands) => {
						const testWindow = window as unknown as Window & {
							__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
						};
						return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(({ command }) =>
							commands.includes(command),
						).length;
					},
					nativeMutationCommands as readonly string[],
				),
			)
			.toBe(0);
		await page.evaluate(
			() =>
				new Promise<void>((resolve) => {
					requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
				}),
		);
		await expect(src).toBeVisible();

		const audit = await page.evaluate(
			(commands) => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				};
				const workspaceCalls = testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
					({ command }) => command.startsWith("workspace_"),
				);
				return {
					capabilities: workspaceCalls.filter(
						({ command }) => command === "workspace_capabilities",
					),
					mutations: workspaceCalls.filter(({ command }) =>
						commands.includes(command),
					),
				};
			},
			nativeMutationCommands as readonly string[],
		);
		expect(audit.capabilities).toEqual([
			{ command: "workspace_capabilities", args: { request: {} } },
		]);
		expect(audit.mutations).toEqual([]);
	} finally {
		page.off("dialog", onDialog);
		page.off("pageerror", onPageError);
		page.off("console", onConsole);
	}
	expect(dialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
	expect(consoleWarnings).toEqual([]);
});

test("keeps single preview tab until pin promotes the editor", async ({
	page,
}) => {
	const errors: string[] = [];
	const nativeDialogs: string[] = [];
	await installNativeIpcMock(page, "arrayBuffer", "supported");
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});

	const explorer = await openNativeWorkspaceExplorer(page);
	const readme = explorer.getByRole("treeitem", {
		name: "README.md",
		exact: true,
	});
	const src = explorer.getByRole("treeitem", { name: "src", exact: true });

	const tabs = page.locator(".tabs-container .tab");
	// The upstream `multiEditorTabsControl` marks a non-pinned (preview) tab's
	// label with an `italic` class (see redrawTabLabel's `italic:
	// !this.tabsModel.isPinned(editor)` and IconLabel#setLabel pushing
	// "italic" onto `.monaco-icon-label`); pinning clears it. This is the
	// real DOM marker probed and frozen for this test, not a guess.
	const previewMarker = (tab: Locator): Locator =>
		tab.locator(".monaco-icon-label.italic");

	// Single click on a file in Explorer opens it as the sole preview tab.
	await readme.click();
	await expect(tabs).toHaveCount(1);
	const readmeTab = tabs.filter({ hasText: "README.md" });
	await expect(readmeTab).toHaveCount(1);
	await expect(previewMarker(readmeTab)).toHaveCount(1);
	await expect(
		page.getByRole("code").filter({ hasText: "Read-only Explorer fixture." }),
	).toBeVisible();

	// Single click on a second file replaces the preview slot: still one tab,
	// and README's tab is gone.
	await src.click();
	await page.keyboard.press("ArrowRight");
	await expect(src).toHaveAttribute("aria-expanded", "true");
	const main = explorer.getByRole("treeitem", {
		name: "main.ts",
		exact: true,
	});
	await main.click();
	await expect(tabs).toHaveCount(1);
	const mainTab = tabs.filter({ hasText: "main.ts" });
	await expect(mainTab).toHaveCount(1);
	await expect(previewMarker(mainTab)).toHaveCount(1);
	await expect(tabs.filter({ hasText: "README.md" })).toHaveCount(0);
	await expect(
		page.getByRole("code").filter({ hasText: "export const plain = true;" }),
	).toBeVisible();

	// Double-clicking the preview tab pins it: the italic marker disappears
	// and no extra tab is created.
	await mainTab.dblclick();
	await expect(tabs).toHaveCount(1);
	await expect(previewMarker(mainTab)).toHaveCount(0);

	// Opening a third file (the now-closed README.md) creates a second,
	// preview tab; the pinned main.ts tab is retained untouched.
	await readme.click();
	await expect(tabs).toHaveCount(2);
	const pinnedMainTab = tabs.filter({ hasText: "main.ts" });
	await expect(pinnedMainTab).toHaveCount(1);
	await expect(previewMarker(pinnedMainTab)).toHaveCount(0);
	const readmePreviewTab = tabs.filter({ hasText: "README.md" });
	await expect(readmePreviewTab).toHaveCount(1);
	await expect(previewMarker(readmePreviewTab)).toHaveCount(1);

	// Editing the preview editor's content pins it via the dirty-state path
	// (`onDidChangeEditorDirty` calls `pinEditor`), independent of double click.
	await page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "Read-only Explorer fixture." })
		.click();
	await page.keyboard.type("X");
	await expect(previewMarker(readmePreviewTab)).toHaveCount(0);
	await expect(tabs).toHaveCount(2);
	await expect(pinnedMainTab).toHaveCount(1);
	await expect(previewMarker(pinnedMainTab)).toHaveCount(0);

	await expect(
		page.locator(".notifications-toasts .notification-toast"),
	).toHaveCount(0);
	expect(nativeDialogs).toEqual([]);
	expect(errors).toEqual([]);
});

test("marks an externally deleted open file orphaned and clears it on restore, while preserving unrelated dirty content", async ({
	page,
}) => {
	const errors: string[] = [];
	const nativeDialogs: string[] = [];
	await installNativeIpcMock(page, "arrayBuffer", "supported");
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});

	const explorer = await openNativeWorkspaceExplorer(page);
	const readme = explorer.getByRole("treeitem", {
		name: "README.md",
		exact: true,
	});
	const src = explorer.getByRole("treeitem", { name: "src", exact: true });

	// Real upstream DOM marker probed and frozen for this test, not a guess:
	// `TextFileService`'s decorations provider (registerListeners in
	// textFileService.ts) reports `strikethrough: true` for an orphaned
	// working copy; `multiEditorTabsControl` always passes a `fileDecorations`
	// object to the tab's `ResourceLabel`, so `IconLabel#setLabel` pushes the
	// "strikethrough" class onto the tab's `.monaco-icon-label` regardless of
	// the `fileDecorations.colors`/`badges` settings.
	const orphanMarker = (tab: Locator): Locator =>
		tab.locator(".monaco-icon-label.strikethrough");

	// Open README.md (preview) and pin it via double click, then open and pin
	// src/main.ts the same way so both stay open as independent tabs.
	await readme.dblclick();
	const readmeTab = page
		.locator(".tabs-container .tab")
		.filter({ hasText: "README.md" });
	await expect(readmeTab).toHaveCount(1);

	await src.click();
	await page.keyboard.press("ArrowRight");
	await expect(src).toHaveAttribute("aria-expanded", "true");
	const main = explorer.getByRole("treeitem", {
		name: "main.ts",
		exact: true,
	});
	await main.dblclick();
	const mainTab = page
		.locator(".tabs-container .tab")
		.filter({ hasText: "main.ts" });
	await expect(mainTab).toHaveCount(1);
	await expect(page.locator(".tabs-container .tab")).toHaveCount(2);

	// The watcher wake listener must be attached before injecting an external
	// change, otherwise the wake could fire before anything is subscribed.
	await expect
		.poll(() =>
			page.evaluate(() => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				};
				return testWindow.__PLAIN_TEST_TAURI_CALLS__.some(
					({ command, args }) =>
						command === "plugin:event|listen" &&
						args.event === "plain://workspace-watch-wake",
				);
			}),
		)
		.toBe(true);

	// External delete of the open, unedited README.md + wake: the provider's
	// bounded stat recheck must fire a precise DELETED for README.md only.
	await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_EXTERNAL_DELETE__(name: string, emitWake: boolean): void;
		};
		testWindow.__PLAIN_TEST_EXTERNAL_DELETE__("README.md", true);
	});
	await expect(orphanMarker(readmeTab)).toHaveCount(1, { timeout: 5_000 });
	await expect(orphanMarker(mainTab)).toHaveCount(0);
	// The root-level coarse UPDATED that accompanies the wake is allowed to
	// reach every open file under the ancestor semantics; main.ts is clean
	// and unrelated to the delete, so it must remain intact and readable.
	await expect(
		page.getByRole("code").filter({ hasText: "export const plain = true;" }),
	).toBeVisible();

	// Dirty main.ts, then trigger another unrelated external change under the
	// same root (another coarse root UPDATED). The dirty edit must survive.
	await page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "export const plain = true;" })
		.click();
	await page.keyboard.press("Home");
	await page.keyboard.type("X");
	await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_EXTERNAL_CREATE__(name: string, emitWake: boolean): void;
		};
		testWindow.__PLAIN_TEST_EXTERNAL_CREATE__("unrelated.txt", true);
	});
	await expect(
		explorer.getByRole("treeitem", { name: "unrelated.txt", exact: true }),
	).toHaveCount(1, { timeout: 5_000 });
	await expect(
		page.getByRole("code").filter({ hasText: "Xexport const plain = true;" }),
	).toBeVisible();
	await expect(orphanMarker(mainTab)).toHaveCount(0);
	await expect(orphanMarker(readmeTab)).toHaveCount(1);

	// External restore (recreate) of README.md + wake clears the orphan mark.
	await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_EXTERNAL_CREATE__(name: string, emitWake: boolean): void;
		};
		testWindow.__PLAIN_TEST_EXTERNAL_CREATE__("README.md", true);
	});
	await expect(orphanMarker(readmeTab)).toHaveCount(0, { timeout: 5_000 });

	expect(nativeDialogs).toEqual([]);
	expect(errors).toEqual([]);
});

test("shows a real dirty count on the tab and the Explorer activity badge, and clears both on save", async ({
	page,
}) => {
	const errors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	await installNativeIpcMock(page, "arrayBuffer", "supported");

	const explorer = await openNativeWorkspaceExplorer(page);
	const readme = explorer.getByRole("treeitem", {
		name: "README.md",
		exact: true,
	});
	await readme.dblclick();
	const editor = page
		.getByRole("code")
		.filter({ hasText: "Read-only Explorer fixture." });
	await expect(editor).toBeVisible();

	const activeTab = page.locator(".tabs-container .tab.active");
	// Real DOM probe (activity bar composite bar renders one badge per
	// view-container action item; Explorer is the sole registered container
	// here): the badge only becomes visible once IWorkingCopyService reports
	// a non-zero dirtyCount, and its .badge-content text mirrors that count.
	const explorerBadge = page.locator(".activitybar .badge").first();
	const explorerBadgeContent = explorerBadge.locator(".badge-content");
	await expect(activeTab).not.toHaveClass(/dirty/);
	await expect(explorerBadge).toBeHidden();

	await page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "Read-only Explorer fixture." })
		.click();
	await page.keyboard.press("End");
	await page.keyboard.type("edited-but-unsaved");

	await expect(activeTab).toHaveClass(/dirty/);
	await expect(explorerBadge).toBeVisible();
	await expect(explorerBadgeContent).toHaveText("1");
	await expect(explorerBadge).toHaveAttribute("aria-label", /1 unsaved file/);

	await page.keyboard.press("ControlOrMeta+S");
	await expect
		.poll(async () =>
			page.evaluate(() => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				};
				return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
					({ command }) => command === "workspace_write_file",
				).length;
			}),
		)
		.toBe(1);
	await expect(activeTab).not.toHaveClass(/dirty/);
	await expect(explorerBadge).toBeHidden();

	expect(nativeDialogs).toEqual([]);
	expect(errors).toEqual([]);
});

test("shows a Reload/Save As/Details save-conflict notification when an external write races a save, keeps the model dirty and the disk untouched, and restores clean state on Reload", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	await installNativeIpcMock(page, "arrayBuffer", "supported");

	const explorer = await openNativeWorkspaceExplorer(page);
	const readme = explorer.getByRole("treeitem", {
		name: "README.md",
		exact: true,
	});
	await readme.dblclick();
	const editor = page
		.getByRole("code")
		.filter({ hasText: "Read-only Explorer fixture." });
	await expect(editor).toBeVisible();
	await page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "Read-only Explorer fixture." })
		.click();
	await page.keyboard.press("End");
	await page.keyboard.type("local-unsaved-edit");
	const activeTab = page.locator(".tabs-container .tab.active");
	await expect(activeTab).toHaveClass(/dirty/);

	// External rewrite of the same open file bumps its version behind the
	// model's back; no wake is emitted so this stays isolated from the S2
	// external-delete/root-refresh paths and only exercises the save-time
	// version mismatch.
	await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_EXTERNAL_WRITE__(
				name: string,
				content: string,
				emitWake: boolean,
			): void;
		};
		testWindow.__PLAIN_TEST_EXTERNAL_WRITE__(
			"README.md",
			"# Native workspace\n\nExternally rewritten while unsaved.\n",
			false,
		);
	});

	await page.keyboard.press("ControlOrMeta+S");
	const toasts = page.locator(".notifications-toasts .notification-toast");
	await expect(toasts).toHaveCount(1);
	const toast = toasts.first();
	await expect(toast).toContainText("Failed to save 'README.md'");
	await expect(toast).toContainText(
		"Reload the file before saving again, or use Save As to preserve your edits.",
	);
	await expect(
		toast.getByRole("button", { name: "Reload", exact: true }),
	).toHaveCount(1);
	await expect(
		toast.getByRole("button", { name: "Save As...", exact: true }),
	).toHaveCount(1);
	await expect(
		toast.getByRole("button", { name: "Details", exact: true }),
	).toHaveCount(1);
	await expect(
		toast.getByRole("button", { name: "Retry", exact: true }),
	).toHaveCount(0);
	await expect(toast.getByRole("button", { name: /Overwrite/ })).toHaveCount(0);

	// The version mismatch is caught by FileService's own stat-based
	// pre-write validation (files-service-override's validateWriteFile),
	// which throws before ever invoking the provider's write path — so the
	// native workspace_write_file command is never dispatched at all, and
	// the workspace's stored bytes can never have been touched by this save
	// attempt. The model is still dirty with the local edit, and reloading
	// below proves the disk/mock tree still holds the external content
	// rather than a silently-accepted local overwrite.
	const writeCallCount = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
			({ command }) => command === "workspace_write_file",
		).length;
	});
	expect(writeCallCount).toBe(0);
	await expect(activeTab).toHaveClass(/dirty/);
	await expect(
		page.getByRole("code").filter({ hasText: "local-unsaved-edit" }),
	).toBeVisible();

	await toast.getByRole("button", { name: "Reload", exact: true }).click();
	await expect(toasts).toHaveCount(0);
	await expect(activeTab).not.toHaveClass(/dirty/);
	await expect(
		page
			.getByRole("code")
			.filter({ hasText: "Externally rewritten while unsaved." }),
	).toBeVisible();
	await expect(
		page.getByRole("code").filter({ hasText: "local-unsaved-edit" }),
	).toHaveCount(0);

	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	// The failed save produces exactly two expected diagnostics (the model's
	// own trace log and NotificationsAlerts' console mirror of the Error
	// severity toast), matching the established diagnostic-mirroring pattern
	// used across this file's other deliberate-failure scenarios.
	expect(consoleErrors).toHaveLength(2);
	expect(consoleErrors[0]).toContain("resulted in a save error");
	expect(consoleErrors[0]).toContain("File Modified Since");
	expect(consoleErrors[1]).toBe(
		"Failed to save 'README.md'. Reload the file before saving again, or use Save As to preserve your edits.",
	);
});

test("restores an unsaved edit as a dirty editor after a simulated hot-exit reload, and stops restoring it once saved", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	await installNativeIpcMock(page, "arrayBuffer", "supported");

	const explorer = await openNativeWorkspaceExplorer(page);
	const readme = explorer.getByRole("treeitem", {
		name: "README.md",
		exact: true,
	});
	// Double-click opens directly as a pinned (not preview) tab, matching S1's
	// established explorer-double-click semantics and avoiding any interaction
	// with the preview-tab-replacement path this test does not exercise.
	await readme.dblclick();
	const editor = page
		.getByRole("code")
		.filter({ hasText: "Read-only Explorer fixture." });
	await expect(editor).toBeVisible();
	const activeTab = page.locator(".tabs-container .tab.active");
	await expect(activeTab).not.toHaveClass(/dirty/);

	await page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "Read-only Explorer fixture." })
		.click();
	await page.keyboard.press("End");
	await page.keyboard.type("unsaved-hot-exit-edit");
	await expect(activeTab).toHaveClass(/dirty/);

	// `files.autoSave` is off, so `hasShortAutoSaveDelay()` is false and the
	// tracker's default backup schedule delay is 1000ms; wait for the
	// resulting backup_write to actually land on the (sessionStorage-backed)
	// mock store before simulating a restart.
	await expect
		.poll(
			async () =>
				page.evaluate(() => {
					const testWindow = window as unknown as Window & {
						__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
					};
					return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
						({ command }) => command === "backup_write",
					).length;
				}),
			{ timeout: 5_000 },
		)
		.toBe(1);

	// Simulate a hot exit + restart: reload re-runs this fixture's
	// `addInitScript` from scratch (fresh in-memory workspace tree, fresh
	// call log), but the backup store round-trips through `sessionStorage`,
	// which the reload itself preserves.
	await page.reload();
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);
	await executePaletteCommand(page, "Open Folder", "File: Open Folder...");

	const restoredTab = page.locator(".tabs-container .tab", {
		hasText: "README.md",
	});
	await expect(restoredTab).toBeVisible();
	await expect(restoredTab).toHaveClass(/dirty/);
	await expect(
		page.getByRole("code").filter({
			hasText: "Read-only Explorer fixture.unsaved-hot-exit-edit",
		}),
	).toBeVisible();

	// Saving discards the backup (the base tracker's own onDidChangeDirty ->
	// discardBackup path, inherited unmodified): a subsequent reload must not
	// restore it again.
	await page.keyboard.press("ControlOrMeta+S");
	await expect
		.poll(async () =>
			page.evaluate(() => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				};
				return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
					({ command }) => command === "workspace_write_file",
				).length;
			}),
		)
		.toBe(1);
	await expect(restoredTab).not.toHaveClass(/dirty/);
	await expect
		.poll(async () =>
			page.evaluate(() => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				};
				return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
					({ command }) => command === "backup_discard",
				).length;
			}),
		)
		.toBe(1);

	await page.reload();
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);
	await executePaletteCommand(page, "Open Folder", "File: Open Folder...");
	// No backup remains, and nothing was manually reopened: no tab of any
	// kind should exist for this fresh workspace re-adoption.
	await expect(page.locator(".tabs-container .tab")).toHaveCount(0);

	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("flushes the newest dirty bytes before both native close and application quit are allowed", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	await installNativeIpcMock(page, "arrayBuffer", "supported");

	const explorer = await openNativeWorkspaceExplorer(page);
	await explorer
		.getByRole("treeitem", { name: "README.md", exact: true })
		.dblclick();
	const editorLine = page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "Read-only Explorer fixture." });
	await editorLine.click();
	await page.keyboard.press("End");
	await page.keyboard.insertText(" native-close-baseline");
	await expect
		.poll(
			async () =>
				page.evaluate(() => {
					const testWindow = window as unknown as Window & {
						__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
					};
					return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
						({ command }) => command === "backup_write",
					).length;
				}),
			{ timeout: 5_000 },
		)
		.toBe(1);

	const emitAndAssert = async (
		reason: "close" | "quit",
		tail: string,
		deferTailUntilAfterNativeEvent = false,
	): Promise<void> => {
		if (!deferTailUntilAfterNativeEvent) {
			await page.keyboard.insertText(tail);
		}
		const requestId = await page.evaluate((nativeReason) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_EMIT_NATIVE_CLOSE__(reason: "close" | "quit"): string;
			};
			return testWindow.__PLAIN_TEST_EMIT_NATIVE_CLOSE__(nativeReason);
		}, reason);
		if (deferTailUntilAfterNativeEvent) {
			await page.keyboard.insertText(tail);
		}
		await expect
			.poll(async () =>
				page.evaluate((id) => {
					const testWindow = window as unknown as Window & {
						__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
					};
					return testWindow.__PLAIN_TEST_TAURI_CALLS__.find(
						({ command, args }) =>
							command === "lifecycle_complete_close" &&
							(
								args.request as
									{ requestId?: string; outcome?: string } | undefined
							)?.requestId === id,
					)?.args;
				}, requestId),
			)
			.toEqual({ request: { requestId, outcome: "allow" } });

		const calls = await page.evaluate(() => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			return testWindow.__PLAIN_TEST_TAURI_CALLS__;
		});
		const markerIndex = calls.findIndex(
			({ command, args }) =>
				command === "__test_emit_native_close__" &&
				args.requestId === requestId,
		);
		const backupIndex = calls.findIndex(
			({ command }, index) => index > markerIndex && command === "backup_write",
		);
		const completionIndex = calls.findIndex(
			({ command, args }, index) =>
				index > backupIndex &&
				command === "lifecycle_complete_close" &&
				(args.request as { requestId?: string } | undefined)?.requestId ===
					requestId,
		);
		expect(markerIndex).toBeGreaterThanOrEqual(0);
		expect(backupIndex).toBeGreaterThan(markerIndex);
		expect(completionIndex).toBeGreaterThan(backupIndex);
		const contentHex = calls[backupIndex]?.args.contentHex;
		expect(typeof contentHex).toBe("string");
		expect(Buffer.from(contentHex as string, "hex").toString("utf8")).toContain(
			tail,
		);
	};

	await emitAndAssert("close", " CLOSE-LATEST");

	// The native test fixture records allow instead of destroying Chromium.
	// Reload models the process boundary and proves that the just-flushed
	// close bytes, rather than the prior one-second backup, are authoritative.
	await page.reload();
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);
	await executePaletteCommand(page, "Open Folder", "File: Open Folder...");
	await expect(
		page.getByRole("code").filter({ hasText: "CLOSE-LATEST" }),
	).toBeVisible();
	await page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "CLOSE-LATEST" })
		.click();
	await page.keyboard.press("End");
	// Native Cmd+Q can overtake Monaco's final queued input task. Model that
	// ordering explicitly: the close request is delivered now, while the last
	// editor mutation becomes observable on the next renderer turn.
	await emitAndAssert("quit", " QUIT-LATEST", true);

	expect(pageErrors).toEqual([]);
});

test("vetoes a native close when the final backup write fails and allows a later retry with the newest bytes", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	await installNativeIpcMock(page, "arrayBuffer", "supported");

	const explorer = await openNativeWorkspaceExplorer(page);
	await explorer
		.getByRole("treeitem", { name: "README.md", exact: true })
		.dblclick();
	await page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "Read-only Explorer fixture." })
		.click();
	await page.keyboard.press("End");
	await page.keyboard.insertText(" veto-baseline");
	await expect
		.poll(
			async () =>
				page.evaluate(() => {
					const testWindow = window as unknown as Window & {
						__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
					};
					return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
						({ command }) => command === "backup_write",
					).length;
				}),
			{ timeout: 5_000 },
		)
		.toBe(1);

	await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_FAILED_BACKUP_WRITES__: number;
			__PLAIN_TEST_RESTORE_INVOKE__(): void;
			__TAURI_INTERNALS__: {
				invoke(
					command: string,
					args?: Record<string, unknown> | Uint8Array,
				): Promise<unknown>;
			};
		};
		const originalInvoke = testWindow.__TAURI_INTERNALS__.invoke.bind(
			testWindow.__TAURI_INTERNALS__,
		);
		testWindow.__PLAIN_TEST_FAILED_BACKUP_WRITES__ = 0;
		testWindow.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
			if (command === "backup_write") {
				testWindow.__PLAIN_TEST_FAILED_BACKUP_WRITES__ += 1;
				throw { code: "BACKUP_WRITE_FAILED", message: "Injected failure." };
			}
			return originalInvoke(command, args);
		};
		testWindow.__PLAIN_TEST_RESTORE_INVOKE__ = () => {
			testWindow.__TAURI_INTERNALS__.invoke = originalInvoke;
		};
	});
	await page.keyboard.insertText(" FAILED-CLOSE-LATEST");
	const failedRequestId = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_EMIT_NATIVE_CLOSE__(reason: "close"): string;
		};
		return testWindow.__PLAIN_TEST_EMIT_NATIVE_CLOSE__("close");
	});
	await expect
		.poll(async () =>
			page.evaluate((requestId) => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
					__PLAIN_TEST_FAILED_BACKUP_WRITES__: number;
				};
				const completion = testWindow.__PLAIN_TEST_TAURI_CALLS__.find(
					({ command, args }) =>
						command === "lifecycle_complete_close" &&
						(args.request as { requestId?: string } | undefined)?.requestId ===
							requestId,
				);
				return {
					failedWrites: testWindow.__PLAIN_TEST_FAILED_BACKUP_WRITES__,
					outcome: (
						completion?.args.request as { outcome?: string } | undefined
					)?.outcome,
				};
			}, failedRequestId),
		)
		.toEqual({ failedWrites: 1, outcome: "veto" });

	// A veto must leave the Workbench alive and unsuspended. Restore the
	// transport, make another edit, and prove a fresh request can flush and
	// close instead of being poisoned by the failed attempt.
	await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_RESTORE_INVOKE__(): void;
		};
		testWindow.__PLAIN_TEST_RESTORE_INVOKE__();
	});
	await page.keyboard.insertText(" RETRY-LATEST");
	const retryRequestId = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_EMIT_NATIVE_CLOSE__(reason: "close"): string;
		};
		return testWindow.__PLAIN_TEST_EMIT_NATIVE_CLOSE__("close");
	});
	await expect
		.poll(async () =>
			page.evaluate((requestId) => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				};
				return testWindow.__PLAIN_TEST_TAURI_CALLS__.find(
					({ command, args }) =>
						command === "lifecycle_complete_close" &&
						(args.request as { requestId?: string } | undefined)?.requestId ===
							requestId,
				)?.args;
			}, retryRequestId),
		)
		.toEqual({ request: { requestId: retryRequestId, outcome: "allow" } });

	const retryEvidence = await page.evaluate((requestId) => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		const calls = testWindow.__PLAIN_TEST_TAURI_CALLS__;
		const marker = calls.findIndex(
			({ command, args }) =>
				command === "__test_emit_native_close__" &&
				args.requestId === requestId,
		);
		const backup = calls.findIndex(
			({ command }, index) => index > marker && command === "backup_write",
		);
		const completion = calls.findIndex(
			({ command, args }, index) =>
				index > backup &&
				command === "lifecycle_complete_close" &&
				(args.request as { requestId?: string } | undefined)?.requestId ===
					requestId,
		);
		return {
			marker,
			backup,
			completion,
			contentHex: calls[backup]?.args.contentHex,
		};
	}, retryRequestId);
	expect(retryEvidence.backup).toBeGreaterThan(retryEvidence.marker);
	expect(retryEvidence.completion).toBeGreaterThan(retryEvidence.backup);
	expect(
		Buffer.from(String(retryEvidence.contentHex), "hex").toString("utf8"),
	).toContain("RETRY-LATEST");
	expect(failedRequestId).not.toBe(retryRequestId);
	expect(pageErrors).toEqual([]);
});

test("restores duplicate-path dirty editors only when each owning root is adopted across a multi-root hot-exit reload", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	await installMultiRootNativeIpcMock(page, "supported", [], [], true);
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") consoleErrors.push(message.text());
	});

	const openDuplicate = async (rootLabel: string): Promise<void> => {
		await page.keyboard.press("ControlOrMeta+P");
		const quickOpen = page.locator(".quick-input-widget");
		await expect(quickOpen).toBeVisible();
		await quickOpen.locator("input").pressSequentially("shared.txt");
		const row = quickOpen.locator(
			`.quick-input-list .monaco-list-row[aria-label*="${rootLabel}"]`,
		);
		await expect(row).toHaveCount(1);
		await row.click();
		await expect(quickOpen).toBeHidden();
	};

	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);
	await executePaletteCommand(page, "Open Folder", "File: Open Folder...");
	await executePaletteCommand(
		page,
		"Add Folder to Workspace",
		"Workspaces: Add Folder to Workspace...",
	);

	await openDuplicate("plain-library");
	await page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "F140 shared secondary" })
		.click();
	await page.keyboard.press("End");
	await page.keyboard.type(" · SECONDARY DIRTY");

	await openDuplicate("plain-workspace");
	await page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "F140 shared primary" })
		.click();
	await page.keyboard.press("End");
	await page.keyboard.type(" · PRIMARY DIRTY");

	await expect
		.poll(
			async () =>
				page.evaluate(() => {
					const testWindow = window as unknown as Window & {
						__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
					};
					return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
						({ command }) => command === "backup_write",
					);
				}),
			{ timeout: 5_000 },
		)
		.toHaveLength(2);
	const backupRoots = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		return testWindow.__PLAIN_TEST_TAURI_CALLS__
			.filter(({ command }) => command === "backup_write")
			.map(({ args }) => args.rootId)
			.sort();
	});
	expect(backupRoots).toEqual([nativeRootId, nativeSecondaryRootId].sort());

	await page.reload();
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);
	// Adopting only primary must restore only primary; the secondary backup
	// remains native-owned but invisible until its exact root is authorized.
	await executePaletteCommand(page, "Open Folder", "File: Open Folder...");
	await expect(page.locator(".tabs-container .tab.dirty")).toHaveCount(1);
	await expect(
		page.getByRole("code").filter({ hasText: "PRIMARY DIRTY" }),
	).toBeVisible();
	await expect(
		page.getByRole("code").filter({ hasText: "SECONDARY DIRTY" }),
	).toHaveCount(0);

	await executePaletteCommand(
		page,
		"Add Folder to Workspace",
		"Workspaces: Add Folder to Workspace...",
	);
	await expect(page.locator(".tabs-container .tab.dirty")).toHaveCount(2);
	await openDuplicate("plain-library");
	await expect(
		page.getByRole("code").filter({ hasText: "SECONDARY DIRTY" }),
	).toBeVisible();
	await openDuplicate("plain-workspace");
	await expect(
		page.getByRole("code").filter({ hasText: "PRIMARY DIRTY" }),
	).toBeVisible();

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("splits an editor into two groups that stay in sync while editing, and returns to one group with content intact after the split side is closed", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	await installNativeIpcMock(page, "arrayBuffer", "supported");

	const explorer = await openNativeWorkspaceExplorer(page);
	const readme = explorer.getByRole("treeitem", {
		name: "README.md",
		exact: true,
	});
	await readme.dblclick();
	await expect(
		page.getByRole("code").filter({ hasText: "Read-only Explorer fixture." }),
	).toBeVisible();

	const groups = page.locator(".editor-group-container");
	await expect(groups).toHaveCount(1);
	await expect(page.locator(".tabs-container .tab")).toHaveCount(1);

	// Real, unmodified upstream keybinding for `workbench.action.splitEditor`
	// (`SplitEditorAction`, `KeyMod.CtrlCmd | KeyCode.Backslash` in
	// src/vs/workbench/browser/parts/editor/editorActions.ts). `splitEditor()`
	// (editorCommands.ts) adds a new group and `group.copyEditor`s the active
	// editor into it, so both groups end up viewing the very same resource.
	await page.keyboard.press("ControlOrMeta+Backslash");
	await expect(groups).toHaveCount(2);

	// Real upstream DOM marker, not a guess: `EditorGroupView#setActive`
	// (editorGroupView.ts) toggles `active`/`inactive` directly on the group's
	// own `.editor-group-container` element; the freshly split group is
	// focused (`splitEditor` calls `newGroup.focus()`), so it alone is
	// `.active` and the original group is `.inactive`.
	const activeGroup = page.locator(".editor-group-container.active");
	const inactiveGroup = page.locator(".editor-group-container.inactive");
	await expect(activeGroup).toHaveCount(1);
	await expect(inactiveGroup).toHaveCount(1);

	const activeTab = activeGroup
		.locator(".tabs-container .tab")
		.filter({ hasText: "README.md" });
	const inactiveTab = inactiveGroup
		.locator(".tabs-container .tab")
		.filter({ hasText: "README.md" });
	await expect(activeTab).toHaveCount(1);
	await expect(inactiveTab).toHaveCount(1);

	// Edit through the new (active) side's own Monaco widget...
	await activeGroup
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "Read-only Explorer fixture." })
		.click();
	await page.keyboard.press("End");
	await page.keyboard.type("-split-edit");

	// ...and the shared text model reflects it instantly in the other side's
	// independent Monaco widget, while both tabs (one per group) go dirty
	// together, since both editors point at the same underlying working copy.
	await expect(
		inactiveGroup
			.locator(".monaco-editor .view-line")
			.filter({ hasText: "Read-only Explorer fixture.-split-edit" }),
	).toBeVisible();
	await expect(activeTab).toHaveClass(/dirty/);
	await expect(inactiveTab).toHaveClass(/dirty/);

	await page.keyboard.press("ControlOrMeta+S");
	await expect
		.poll(async () =>
			page.evaluate(() => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				};
				return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
					({ command }) => command === "workspace_write_file",
				).length;
			}),
		)
		.toBe(1);
	await expect(activeTab).not.toHaveClass(/dirty/);
	await expect(inactiveTab).not.toHaveClass(/dirty/);

	// Closing the split (active) side's sole tab empties that group, which
	// `workbench.editor.closeEmptyGroups` (default true, editor.ts) then
	// removes automatically, returning to a single group with the saved
	// content intact.
	await page.keyboard.press("ControlOrMeta+W");
	await expect(groups).toHaveCount(1);
	await expect(page.locator(".tabs-container .tab")).toHaveCount(1);
	await expect(page.locator(".tabs-container .tab.dirty")).toHaveCount(0);
	await expect(
		page
			.getByRole("code")
			.filter({ hasText: "Read-only Explorer fixture.-split-edit" }),
	).toBeVisible();

	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("opens a PNG through Explorer as the real binary-file placeholder pane instead of crashing or rendering blank", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	await installNativeIpcMock(page, "arrayBuffer", "supported");

	const explorer = await openNativeWorkspaceExplorer(page);
	const icon = explorer.getByRole("treeitem", {
		name: "icon.png",
		exact: true,
	});
	await icon.dblclick();

	// Real upstream detection path, not a name/extension special case: the PNG
	// fixture's genuine 0x00 bytes make `detectEncodingFromBuffer` (src/vs/
	// workbench/services/textfile/common/encoding.ts) report `seemsBinary`,
	// which `TextFileEditorModel` turns into a `FILE_IS_BINARY` error that
	// `FileEditorInput#resolve` (fileEditorInput.ts) catches to select
	// `BinaryFileEditor` over `TextFileEditor` for this input.
	await expect(
		page.locator(".tabs-container .tab").filter({ hasText: "icon.png" }),
	).toHaveCount(1);

	// Real upstream DOM markers, not a guess: `BaseBinaryResourceEditor`
	// (binaryEditor.ts) renders through `EditorPlaceholder` (editorPlaceholder.ts),
	// whose `.monaco-editor-pane-placeholder` container holds a
	// `.editor-placeholder-label-container` with the exact upstream
	// `fileBinaryError` string and an "Open Anyway" action button.
	const placeholder = page.locator(".monaco-editor-pane-placeholder");
	await expect(placeholder).toBeVisible();
	await expect(
		placeholder.locator(".editor-placeholder-label-container"),
	).toHaveText(
		"The file is not displayed in the text editor because it is either binary or uses an unsupported text encoding.",
	);
	await expect(
		placeholder.getByRole("button", { name: "Open Anyway", exact: true }),
	).toBeVisible();

	// No crash and no blank editor: the placeholder pane is a dedicated
	// `EditorPane`, not a `CodeEditorWidget`, so no `.monaco-editor` exists
	// underneath it at all while the fallback is showing.
	await expect(page.locator(".monaco-editor")).toHaveCount(0);

	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("opens a Markdown file as a plain Monaco text editor with no rich preview surface, and saves edits normally", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	await installNativeIpcMock(page, "arrayBuffer", "supported");

	const explorer = await openNativeWorkspaceExplorer(page);
	const notes = explorer.getByRole("treeitem", {
		name: "notes.md",
		exact: true,
	});
	await notes.dblclick();

	const editor = page
		.getByRole("code")
		.filter({ hasText: "Plain markdown source text, no rich preview here." });
	await expect(editor).toBeVisible();
	await expect(page.locator(".monaco-editor")).toHaveCount(1);

	// Plain bundles no markdown-language-features/media-preview extension and
	// no webview-service-override at all (see app/services.ts and this
	// package's dependencies): there is no rich-render surface for this app to
	// fall back *from*, so this is a real absence check against the genuine
	// upstream webview DOM marker (`element.className = 'webview ...'` in
	// src/vs/workbench/contrib/webview/browser/webviewElement.ts), not a mock.
	await expect(page.locator(".webview")).toHaveCount(0);
	await expectPaletteCommandHidden(
		page,
		"Markdown: Open Preview",
		"Markdown: Open Preview",
	);

	await page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "Plain markdown source text, no rich preview here." })
		.click();
	await page.keyboard.press("End");
	await page.keyboard.type(" Edited.");
	const activeTab = page.locator(".tabs-container .tab.active");
	await expect(activeTab).toHaveClass(/dirty/);

	await page.keyboard.press("ControlOrMeta+S");
	await expect
		.poll(async () =>
			page.evaluate(() => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				};
				return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
					({ command }) => command === "workspace_write_file",
				).length;
			}),
		)
		.toBe(1);
	await expect(activeTab).not.toHaveClass(/dirty/);
	await expect(
		page.getByRole("code").filter({
			hasText: "Plain markdown source text, no rich preview here. Edited.",
		}),
	).toBeVisible();

	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("opens Quick Open with Cmd+P and stays stable while typing, including on an absolute path", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	// A nested directory with its own `.gitignore` (ignoring one sibling
	// file): proves file search both walks into subdirectories and honors
	// `.gitignore`, not just the flat root fixture.
	await installNativeIpcMock(page, "arrayBuffer", "supported", {
		"notes-archive/.gitignore": "secret.txt\n",
		"notes-archive/secret.txt": "hidden contents\n",
		"notes-archive/visible.txt": "visible contents\n",
	});
	await openNativeWorkspaceExplorer(page);

	const quickOpen = page.locator(".quick-input-widget");
	await page.keyboard.press("ControlOrMeta+P");
	await expect(quickOpen).toBeVisible();
	await expect(quickOpen.locator("input")).toBeFocused();

	// AnythingQuickAccessProvider's own upstream `NO_RESULTS_PICK` renders a
	// single "No matching results" row whenever the picker has zero real
	// picks (see anythingQuickAccess.js) — the genuine empty-results DOM
	// state, not a guess or a mock.
	const noMatchingResultsRow = quickOpen
		.locator(".quick-input-list .monaco-list-row")
		.filter({ hasText: "No matching results" });
	const resultRows = quickOpen.locator(".quick-input-list .monaco-list-row");

	// PlainSearchService's fileSearch now routes through the Rust search
	// domain (see app/features/search/plain-search-service.ts and
	// src-tauri/src/search/file_search.rs): a real, non-ignored match must
	// appear.
	await quickOpen.locator("input").pressSequentially("readme");
	await expect(resultRows.filter({ hasText: "README.md" })).toHaveCount(1);
	await expect(noMatchingResultsRow).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(quickOpen).toBeHidden();

	// The `.gitignore`-ignored file never appears...
	await page.keyboard.press("ControlOrMeta+P");
	await expect(quickOpen).toBeVisible();
	await quickOpen.locator("input").pressSequentially("secret");
	await expect(quickOpen).toBeVisible();
	await expect(resultRows).toHaveCount(1);
	await expect(noMatchingResultsRow).toHaveCount(1);
	await page.keyboard.press("Escape");
	await expect(quickOpen).toBeHidden();

	// ...while its non-ignored sibling in the same directory does, and
	// selecting it with Enter opens the file in the editor.
	await page.keyboard.press("ControlOrMeta+P");
	await expect(quickOpen).toBeVisible();
	await quickOpen.locator("input").pressSequentially("visible");
	const visiblePick = resultRows.filter({ hasText: "visible.txt" });
	await expect(visiblePick).toHaveCount(1);
	await expect(noMatchingResultsRow).toHaveCount(0);
	await page.keyboard.press("Enter");
	await expect(quickOpen).toBeHidden();
	await expect(
		page.getByRole("code").filter({ hasText: "visible contents" }),
	).toBeVisible();

	// A fragment matching nothing at all still renders the upstream
	// empty-results row rather than an error.
	await page.keyboard.press("ControlOrMeta+P");
	await expect(quickOpen).toBeVisible();
	await quickOpen.locator("input").pressSequentially("zzz-no-such-file");
	await expect(quickOpen).toBeVisible();
	await expect(
		quickOpen.locator(".quick-input-list .monaco-list-row"),
	).toHaveCount(1);
	await expect(noMatchingResultsRow).toHaveCount(1);
	await page.keyboard.press("Escape");
	await expect(quickOpen).toBeHidden();

	// AnythingQuickAccessProvider.getAbsolutePathFileResult tries to stat an
	// absolute path directly through IFileService, bypassing fileSearch
	// entirely — a real code path probed here rather than assumed. Plain
	// registers no `file:` provider at all, so it fails closed by itself: no
	// pick, no crash, no native dialog, same empty-results row as any other
	// query.
	await page.keyboard.press("ControlOrMeta+P");
	await expect(quickOpen).toBeVisible();
	await quickOpen.locator("input").pressSequentially("/etc/passwd");
	await expect(quickOpen).toBeVisible();
	await expect(
		quickOpen.locator(".quick-input-list .monaco-list-row"),
	).toHaveCount(1);
	await expect(noMatchingResultsRow).toHaveCount(1);
	await page.keyboard.press("Escape");
	await expect(quickOpen).toBeHidden();

	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("keeps duplicate Quick Open and text-search paths bound to their producing workspace root", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	await installMultiRootNativeIpcMock(page, "supported");
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});

	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);
	await executePaletteCommand(page, "Open Folder", "File: Open Folder...");
	await executePaletteCommand(
		page,
		"Add Folder to Workspace",
		"Workspaces: Add Folder to Workspace...",
	);

	const quickOpen = page.locator(".quick-input-widget");
	await page.keyboard.press("ControlOrMeta+P");
	await expect(quickOpen).toBeVisible();
	await quickOpen.locator("input").pressSequentially("shared.txt");
	const duplicateRows = quickOpen
		.locator(".quick-input-list .monaco-list-row")
		.filter({ hasText: "shared.txt" });
	await expect(duplicateRows).toHaveCount(2);
	const secondaryRow = quickOpen.locator(
		'.quick-input-list .monaco-list-row[aria-label*="plain-library"]',
	);
	await expect(secondaryRow).toHaveCount(1);
	await secondaryRow.click();
	await expect(quickOpen).toBeHidden();
	await expect(
		page.getByRole("code").filter({ hasText: "F140 shared secondary" }),
	).toBeVisible();

	await page.getByRole("tab", { name: /^Search/ }).click();
	const searchInput = page.locator(".plain-search-view-input");
	const replaceInput = page.locator(".plain-search-view-replace-input");
	const status = page.locator(".plain-search-view-status");
	const messages = page.locator(".plain-search-view-messages");
	await searchInput.pressSequentially("F140 shared secondary");
	await expect(status).toHaveText("1 result in 1 file", { timeout: 5_000 });
	await replaceInput.fill("F140 replaced secondary");
	await page.locator(".plain-search-view-replace-all").click();
	await expect(messages).toHaveText("Replaced 1 match.");
	await expect(
		page.getByRole("code").filter({ hasText: "F140 replaced secondary" }),
	).toBeVisible();

	// The write must target the secondary root despite the duplicate relative
	// path. The primary copy remains searchable and opens with its original
	// content, proving replace did not merely select the first workspace root.
	const writes = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
			({ command }) => command === "workspace_write_file",
		);
	});
	expect(writes).toHaveLength(1);
	expect(writes[0]!.args.request).toEqual({
		rootId: nativeSecondaryRootId,
		relativePath: "shared.txt",
		expectedVersion: expect.stringMatching(/^wv1:[0-9a-f]{64}$/u),
	});
	expect(writes[0]!.args.contentHex).toBe(
		hexOfText("F140 replaced secondary\n"),
	);

	await searchInput.fill("F140 shared primary");
	await expect(status).toHaveText("1 result in 1 file", { timeout: 5_000 });
	await page.locator(".plain-search-view-match").click();
	await expect(
		page.getByRole("code").filter({ hasText: "F140 shared primary" }),
	).toBeVisible();

	const searchCalls = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
			({ command }) =>
				command === "workspace_search_files" ||
				command === "workspace_search_text_start",
		);
	});
	expect(
		searchCalls.some(
			(call) =>
				JSON.stringify(
					(call.args.request as { roots?: readonly string[] } | undefined)
						?.roots,
				) === JSON.stringify([nativeRootId, nativeSecondaryRootId]),
		),
	).toBe(true);
	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("shows a Search icon in the Activity Bar, opens the Search view, and stays stable with empty results while typing a query", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	await installNativeIpcMock(page, "arrayBuffer", "supported");
	await openNativeWorkspaceExplorer(page);

	const searchActivityIcon = page.getByRole("tab", { name: /^Search/ });
	await expect(searchActivityIcon).toHaveCount(1);
	await searchActivityIcon.click();

	const searchInput = page.locator(".plain-search-view-input");
	await expect(searchInput).toBeVisible();
	const status = page.locator(".plain-search-view-status");

	await searchInput.pressSequentially("zzz-no-such-term");
	await expect(status).toHaveText("No results found.", { timeout: 5_000 });
	await expect(page.locator(".plain-search-view-body")).toBeVisible();

	await searchInput.fill("");
	await expect(status).toHaveText("");

	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("streams grouped text search results across files and opens a match in the editor", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	// Two files sharing a term: proves file search's mock streams *grouped*
	// results across more than one file, not just a single-file smoke test.
	// The mock's own default of one batch per poll (see
	// `installNativeIpcMock`'s `searchTextMatches`/`workspace_search_text_poll`
	// case) already exercises genuine multi-poll delivery underneath; this
	// test asserts the end-to-end, full-stack outcome (both groups render
	// with the right content, a click navigates correctly, a new query
	// cancels the old one) rather than re-proving the batching protocol
	// itself, which the Rust and browser-mock unit suites already cover in
	// much finer-grained detail.
	await installNativeIpcMock(page, "arrayBuffer", "supported", {
		"notes-archive/needle-a.txt": "needle one\n",
		"notes-archive/needle-b.txt": "needle two\n",
	});
	await openNativeWorkspaceExplorer(page);

	await page.getByRole("tab", { name: /^Search/ }).click();
	const searchInput = page.locator(".plain-search-view-input");
	await expect(searchInput).toBeVisible();
	const status = page.locator(".plain-search-view-status");
	const fileGroups = page.locator(".plain-search-view-file");

	await searchInput.pressSequentially("needle");
	await expect(status).toHaveText("2 results in 2 files", { timeout: 5_000 });
	await expect(fileGroups).toHaveCount(2);
	await expect(
		fileGroups.filter({ hasText: "notes-archive/needle-a.txt" }),
	).toHaveCount(1);
	await expect(
		fileGroups.filter({ hasText: "notes-archive/needle-b.txt" }),
	).toHaveCount(1);

	const firstMatch = page
		.locator(".plain-search-view-match")
		.filter({ hasText: "needle one" });
	await expect(firstMatch).toBeVisible();
	await firstMatch.click();
	await expect(
		page.getByRole("tab", { name: /^needle-a\.txt(?:,.*)?$/ }),
	).toBeVisible();
	await expect(
		page.getByRole("code").filter({ hasText: "needle one" }),
	).toBeVisible();

	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("cancels the previous search as soon as the query changes while it is still streaming", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	// A per-poll delay keeps the first search reliably still in flight (not
	// yet naturally completed) at the moment the second query is typed,
	// instead of racing a same-tick mock that could otherwise finish first.
	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"supported",
		{
			"notes-archive/needle-a.txt": "needle one\n",
			"notes-archive/needle-b.txt": "needle two\n",
		},
		20_000,
		200,
	);
	await openNativeWorkspaceExplorer(page);

	await page.getByRole("tab", { name: /^Search/ }).click();
	const searchInput = page.locator(".plain-search-view-input");
	await expect(searchInput).toBeVisible();
	const status = page.locator(".plain-search-view-status");

	await searchInput.pressSequentially("needle");
	// The first poll response (200ms artificial delay) has not resolved yet,
	// so the search is still genuinely in flight here.
	await expect(status).toHaveText("Searching…", { timeout: 5_000 });

	await searchInput.fill("");
	await searchInput.pressSequentially("nothing-matches-this");
	await expect(status).toHaveText("No results found.", { timeout: 5_000 });

	const calls = (await page.evaluate(
		() =>
			(
				window as unknown as {
					__PLAIN_TEST_TAURI_CALLS__: readonly {
						command: string;
						args: Record<string, unknown>;
					}[];
				}
			).__PLAIN_TEST_TAURI_CALLS__,
	)) as readonly { command: string; args: Record<string, unknown> }[];
	const cancelCalls = calls.filter(
		(call) => call.command === "workspace_search_text_cancel",
	);
	const startCalls = calls.filter(
		(call) => call.command === "workspace_search_text_start",
	);
	expect(cancelCalls.length).toBeGreaterThanOrEqual(1);
	expect(startCalls.length).toBe(2);

	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("shows a truncation banner past the match limit and a message for an invalid regular expression", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"supported",
		{
			"notes-archive/one.txt": "needle\n",
			"notes-archive/two.txt": "needle\n",
			"notes-archive/three.txt": "needle\n",
		},
		2,
	);
	await openNativeWorkspaceExplorer(page);

	await page.getByRole("tab", { name: /^Search/ }).click();
	const searchInput = page.locator(".plain-search-view-input");
	const messages = page.locator(".plain-search-view-messages");
	const status = page.locator(".plain-search-view-status");

	await searchInput.pressSequentially("needle");
	await expect(status).toHaveText("2 results in 2 files", { timeout: 5_000 });
	await expect(messages).toContainText("Too many results", { timeout: 5_000 });

	await searchInput.fill("");
	await page.locator(".plain-search-view-regex-toggle").check();
	await searchInput.pressSequentially("(unclosed");
	await expect(messages).not.toHaveText("", { timeout: 5_000 });
	await expect(messages).toContainText("regular expression");

	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

// --- F040 S4: replace (docs/research/2026-07-23-search-quickopen.md decision 3) ---

/** UTF-8 byte hex of `text`, matching the exact encoding `workspace_write_file`
 * calls capture their PLW1 frame content as (see `installNativeIpcMock`'s own
 * `contentHex: hexFromBytes(frame.content)`). */
function hexOfText(text: string): string {
	return [...new TextEncoder().encode(text)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

async function nativeWriteFileCalls(page: Page): Promise<
	readonly {
		readonly request: { readonly relativePath: string };
		readonly contentHex: string;
	}[]
> {
	return page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		return testWindow.__PLAIN_TEST_TAURI_CALLS__
			.filter(({ command }) => command === "workspace_write_file")
			.map(({ args }) => args) as unknown as {
			request: { relativePath: string };
			contentHex: string;
		}[];
	});
}

/** Every recorded `__PLAIN_TEST_TAURI_CALLS__` invocation of `command`, in
 * order — a generic counterpart to `nativeWriteFileCalls` for assertions
 * that need the raw request body of a command other than
 * `workspace_write_file`. */
async function nativeCallsFor(
	page: Page,
	command: string,
): Promise<readonly TestTauriInvocation[]> {
	return page.evaluate((command) => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
			(call) => call.command === command,
		);
	}, command);
}

test("replaces every match across multiple files (one already open in an editor) and saves through the versioned write chain", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	await installNativeIpcMock(page, "arrayBuffer", "supported", {
		"replace-a.txt": "needle one\nneedle two\n",
		"replace-b.txt": "needle three\n",
	});
	const explorer = await openNativeWorkspaceExplorer(page);

	// One of the two files is already open (and clean) in an editor before the
	// search+replace even starts — proves the replace path both edits/saves a
	// resource resolved fresh for the first time (replace-b.txt) *and*
	// correctly reuses/edits an already-resolved, already-open model
	// (replace-a.txt), syncing its live editor buffer rather than only the
	// on-disk bytes.
	await explorer
		.getByRole("treeitem", { name: "replace-a.txt", exact: true })
		.dblclick();
	await expect(
		page.getByRole("code").filter({ hasText: "needle one" }),
	).toBeVisible();

	await page.getByRole("tab", { name: /^Search/ }).click();
	const searchInput = page.locator(".plain-search-view-input");
	const replaceInput = page.locator(".plain-search-view-replace-input");
	const status = page.locator(".plain-search-view-status");
	const messages = page.locator(".plain-search-view-messages");
	const fileGroups = page.locator(".plain-search-view-file");

	await searchInput.pressSequentially("needle");
	await expect(status).toHaveText("3 results in 2 files", { timeout: 5_000 });
	await expect(fileGroups).toHaveCount(2);

	await replaceInput.fill("cactus");
	await page.locator(".plain-search-view-replace-all").click();

	await expect(fileGroups).toHaveCount(0, { timeout: 5_000 });
	await expect(messages).toHaveText("Replaced 3 matches.");

	// The already-open editor's live buffer reflects the replacement and is
	// clean again (saved, not just edited in memory).
	await expect(
		page.getByRole("code").filter({ hasText: "cactus one" }),
	).toBeVisible();
	await expect(
		page.getByRole("code").filter({ hasText: "cactus two" }),
	).toBeVisible();
	const activeTab = page.locator(".tabs-container .tab.active");
	await expect(activeTab).not.toHaveClass(/dirty/);

	const writes = await nativeWriteFileCalls(page);
	expect(writes).toHaveLength(2);
	const byPath = new Map(
		writes.map((write) => [write.request.relativePath, write.contentHex]),
	);
	expect(byPath.get("replace-a.txt")).toBe(
		hexOfText("cactus one\ncactus two\n"),
	);
	expect(byPath.get("replace-b.txt")).toBe(hexOfText("cactus three\n"));

	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("replaces only the single match a per-match Replace button targets, leaving its sibling match untouched", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	await installNativeIpcMock(page, "arrayBuffer", "supported", {
		"solo.txt": "needle alpha\nneedle beta\n",
	});
	await openNativeWorkspaceExplorer(page);

	await page.getByRole("tab", { name: /^Search/ }).click();
	const searchInput = page.locator(".plain-search-view-input");
	const replaceInput = page.locator(".plain-search-view-replace-input");
	const status = page.locator(".plain-search-view-status");

	await searchInput.pressSequentially("needle");
	await expect(status).toHaveText("2 results in 1 file", { timeout: 5_000 });

	await replaceInput.fill("gamma");
	const firstRow = page
		.locator(".plain-search-view-match-row")
		.filter({ hasText: "needle alpha" });
	await firstRow.locator(".plain-search-view-replace-match").click();

	await expect(status).toHaveText("1 result in 1 file", { timeout: 5_000 });
	await expect(firstRow).toHaveCount(0);
	await expect(
		page
			.locator(".plain-search-view-match-row")
			.filter({ hasText: "needle beta" }),
	).toHaveCount(1);
	await expect(page.locator(".plain-search-view-file")).toHaveCount(1);

	const writes = await nativeWriteFileCalls(page);
	expect(writes).toHaveLength(1);
	expect(writes[0]!.request.relativePath).toBe("solo.txt");
	expect(writes[0]!.contentHex).toBe(hexOfText("gamma alpha\nneedle beta\n"));

	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("keeps a version-conflicted file's replace visibly failed while a sibling file's replace still succeeds", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	await installNativeIpcMock(page, "arrayBuffer", "supported", {
		"conflict.txt": "needle stays\n",
		"ok.txt": "needle also\n",
	});
	const explorer = await openNativeWorkspaceExplorer(page);

	// Open conflict.txt first so its model resolves and caches a baseline
	// version *before* the external rewrite below bumps the file's real
	// version on the "server" (mock) side — exactly the precondition the
	// existing manual-edit save-conflict test uses (see "shows a
	// Reload/Save As/Details save-conflict notification..." above). The
	// external rewrite intentionally reuses the exact same text so the
	// match's line/column position is unaffected — this test is about a
	// stale version at save time, not about content drifting out from under
	// the search coordinates.
	await explorer
		.getByRole("treeitem", { name: "conflict.txt", exact: true })
		.dblclick();
	await expect(
		page.getByRole("code").filter({ hasText: "needle stays" }),
	).toBeVisible();
	await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_EXTERNAL_WRITE__(
				name: string,
				content: string,
				emitWake: boolean,
			): void;
		};
		testWindow.__PLAIN_TEST_EXTERNAL_WRITE__(
			"conflict.txt",
			"needle stays\n",
			false,
		);
	});

	await page.getByRole("tab", { name: /^Search/ }).click();
	const searchInput = page.locator(".plain-search-view-input");
	const replaceInput = page.locator(".plain-search-view-replace-input");
	const status = page.locator(".plain-search-view-status");
	const messages = page.locator(".plain-search-view-messages");
	const fileGroups = page.locator(".plain-search-view-file");

	await searchInput.pressSequentially("needle");
	await expect(status).toHaveText("2 results in 2 files", { timeout: 5_000 });

	await replaceInput.fill("cactus");
	await page.locator(".plain-search-view-replace-all").click();

	// Partial success: ok.txt's group disappears (replaced), conflict.txt's
	// stays with its match still present and a visible inline failure.
	await expect(fileGroups).toHaveCount(1, { timeout: 5_000 });
	await expect(fileGroups.filter({ hasText: "conflict.txt" })).toHaveCount(1);
	await expect(fileGroups.filter({ hasText: "ok.txt" })).toHaveCount(0);
	await expect(
		fileGroups
			.filter({ hasText: "conflict.txt" })
			.locator(".plain-search-view-file-error"),
	).toContainText("failed to save");
	await expect(messages).toHaveText(
		"Replaced 1 match. 1 replacement failed to save.",
	);

	// Same Reload/Save As/Details, no Retry/Overwrite conflict surface the
	// manual-edit save path already shows — proving replace routes through
	// the exact same TextFileSaveErrorHandler, not a bespoke replace dialog.
	const toasts = page.locator(".notifications-toasts .notification-toast");
	await expect(toasts).toHaveCount(1);
	const toast = toasts.first();
	await expect(toast).toContainText("Failed to save 'conflict.txt'");
	await expect(
		toast.getByRole("button", { name: "Reload", exact: true }),
	).toHaveCount(1);
	await expect(
		toast.getByRole("button", { name: "Save As...", exact: true }),
	).toHaveCount(1);
	await expect(
		toast.getByRole("button", { name: "Details", exact: true }),
	).toHaveCount(1);
	await expect(
		toast.getByRole("button", { name: "Retry", exact: true }),
	).toHaveCount(0);
	await expect(toast.getByRole("button", { name: /Overwrite/ })).toHaveCount(0);

	// The conflicted file's own editor is still open and still dirty (the
	// bulk edit mutated it in memory, but the save failed) — the disk/mock
	// tree therefore must not have been touched for it, while ok.txt's write
	// went through normally.
	const activeTab = page.locator(".tabs-container .tab.active");
	await expect(activeTab).toHaveText(/^conflict\.txt/);
	await expect(activeTab).toHaveClass(/dirty/);

	const writes = await nativeWriteFileCalls(page);
	expect(writes).toHaveLength(1);
	expect(writes[0]!.request.relativePath).toBe("ok.txt");
	expect(writes[0]!.contentHex).toBe(hexOfText("cactus also\n"));

	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	// Same diagnostic-mirroring pattern as the manual-edit conflict test: the
	// model's own trace of the save error, plus the notification's console
	// mirror of the Error-severity toast.
	expect(consoleErrors).toHaveLength(2);
	expect(consoleErrors[0]).toContain("resulted in a save error");
	expect(consoleErrors[0]).toContain("File Modified Since");
	expect(consoleErrors[1]).toBe(
		"Failed to save 'conflict.txt'. Reload the file before saving again, or use Save As to preserve your edits.",
	);
});

test("rejects stale search coordinates for an unopened externally rewritten file before any edit or write", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	await installNativeIpcMock(page, "arrayBuffer", "supported", {
		"stale-unopened.txt": "replace needle stable\n",
	});
	await openNativeWorkspaceExplorer(page);

	await page.getByRole("tab", { name: /^Search/ }).click();
	const searchInput = page.locator(".plain-search-view-input");
	const replaceInput = page.locator(".plain-search-view-replace-input");
	const status = page.locator(".plain-search-view-status");
	await searchInput.pressSequentially("needle");
	await expect(status).toHaveText("1 result in 1 file", { timeout: 5_000 });
	await replaceInput.fill("cactus");

	// Keep the old result visible while changing the authoritative file. This
	// is the real desktop failure E2E-004 exposed: resolving an unopened model
	// only after this rewrite used to apply the stale column to fresh content
	// and then save successfully because that fresh model also held the fresh
	// wv1 token.
	await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_EXTERNAL_WRITE__(
				name: string,
				content: string,
				emitWake: boolean,
			): void;
		};
		testWindow.__PLAIN_TEST_EXTERNAL_WRITE__(
			"stale-unopened.txt",
			"external changed stable\n",
			false,
		);
	});
	await page.locator(".plain-search-view-replace-match").click();

	await expect(page.locator(".plain-search-view-file-error")).toContainText(
		"failed to save",
	);
	await expect(page.locator(".plain-search-view-messages")).toHaveText(
		"1 replacement failed to save.",
	);
	const toast = page.locator(".notifications-toasts .notification-toast");
	await expect(toast).toHaveCount(1);
	await expect(toast).toContainText(
		"The file changed on disk after these search results were produced.",
	);
	for (const action of ["Reload", "Save As...", "Details"]) {
		await expect(
			toast.getByRole("button", { name: action, exact: true }),
		).toHaveCount(1);
	}
	await expect(
		toast.getByRole("button", { name: "Retry", exact: true }),
	).toHaveCount(0);
	await expect(toast.getByRole("button", { name: /Overwrite/ })).toHaveCount(0);

	// Preflight conflict means no in-memory edit and no native write at all.
	expect(await nativeWriteFileCalls(page)).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([
		"Failed to replace 'stale-unopened.txt'. The file changed on disk after these search results were produced.",
	]);
});

test("replaces a match correctly using its absolute column even when the line is far longer than the 256-unit preview window", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	// Distinct padding characters on either side of the match: if replace ever
	// used the preview-relative column (rebased to the match, per the F040 S3
	// preview-windowing doc) instead of the absolute one, the edit would land
	// at the wrong offset and corrupt one of the two padding runs in an
	// easily distinguishable way, rather than cleanly replacing only
	// "needle".
	const before = "x".repeat(400);
	const after = "y".repeat(400);
	await installNativeIpcMock(page, "arrayBuffer", "supported", {
		"long-line.txt": `${before}needle${after}\n`,
	});
	await openNativeWorkspaceExplorer(page);

	await page.getByRole("tab", { name: /^Search/ }).click();
	const searchInput = page.locator(".plain-search-view-input");
	const replaceInput = page.locator(".plain-search-view-replace-input");
	const status = page.locator(".plain-search-view-status");

	await searchInput.pressSequentially("needle");
	await expect(status).toHaveText("1 result in 1 file", { timeout: 5_000 });

	await replaceInput.fill("cactus");
	await page.locator(".plain-search-view-replace-match").click();

	await expect(status).toHaveText("No results found.", { timeout: 5_000 });

	const writes = await nativeWriteFileCalls(page);
	expect(writes).toHaveLength(1);
	expect(writes[0]!.request.relativePath).toBe("long-line.txt");
	expect(writes[0]!.contentHex).toBe(hexOfText(`${before}cactus${after}\n`));

	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("excludes a node_modules directory from both Quick Open file search and Search view text search by default", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	// A same-named file inside node_modules and a kept sibling outside it,
	// neither covered by any .gitignore: proves the exclusion comes from
	// F040 S5's real `search.exclude` schema default
	// (`{"**/node_modules": true, ...}`, registered in
	// app/features/search/search-contribution.ts) flowing through the
	// already-working excludePattern plumbing, not from gitignore or a
	// name-based special case.
	await installNativeIpcMock(page, "arrayBuffer", "supported", {
		"node_modules/dep/index.js":
			"const excludedMarker = 'node-modules-should-not-be-found';\n",
		"src/index.js": "const keptMarker = 'kept-marker-should-be-found';\n",
	});
	await openNativeWorkspaceExplorer(page);

	// Quick Open file search: the node_modules copy of index.js never
	// appears among the picks, only the kept sibling does.
	const quickOpen = page.locator(".quick-input-widget");
	const resultRows = quickOpen.locator(".quick-input-list .monaco-list-row");
	await page.keyboard.press("ControlOrMeta+P");
	await expect(quickOpen).toBeVisible();
	await quickOpen.locator("input").pressSequentially("index.js");
	// Exactly one pick: the picker's label/description/detail render as one
	// concatenated text node ("index.jssrcfile results", no path separator),
	// so identity is asserted by total count plus the absence of
	// "node_modules" and the presence of the kept file's own directory name
	// rather than a literal "src/index.js" substring.
	await expect(resultRows).toHaveCount(1);
	await expect(resultRows.filter({ hasText: "node_modules" })).toHaveCount(0);
	await expect(resultRows.filter({ hasText: "src" })).toHaveCount(1);
	await page.keyboard.press("Escape");
	await expect(quickOpen).toBeHidden();

	// Search view text search: searching for content that only exists
	// inside node_modules finds nothing, while the kept file's own content
	// is found normally.
	await page.getByRole("tab", { name: /^Search/ }).click();
	const searchInput = page.locator(".plain-search-view-input");
	await expect(searchInput).toBeVisible();
	const status = page.locator(".plain-search-view-status");
	const fileGroups = page.locator(".plain-search-view-file");

	await searchInput.pressSequentially("node-modules-should-not-be-found");
	await expect(status).toHaveText("No results found.", { timeout: 5_000 });
	await expect(fileGroups).toHaveCount(0);

	await searchInput.fill("");
	await searchInput.pressSequentially("kept-marker-should-be-found");
	await expect(status).toHaveText("1 result in 1 file", { timeout: 5_000 });
	await expect(fileGroups.filter({ hasText: "src/index.js" })).toHaveCount(1);

	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

// --- F200 S1: entry commands, keybindings and case/word toggles
// (docs/research/2026-08-04-complete-search.md §"架构裁定 1") ---

test("Cmd/Ctrl+Shift+F opens the Search view and focuses the search input with select-all semantics; both commands are visible and executable via the Command Palette", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	await installNativeIpcMock(page, "arrayBuffer", "supported");
	// Lands on the Explorer view — the shortcut below must both reveal the
	// Search view (not yet open) and move focus into it, not merely no-op on
	// an already-visible view.
	await openNativeWorkspaceExplorer(page);

	await page.keyboard.press("ControlOrMeta+Shift+F");
	const searchInput = page.locator(".plain-search-view-input");
	await expect(searchInput).toBeVisible();
	await expect(searchInput).toBeFocused();

	// A repeat invocation with an existing query re-selects it (VS Code's own
	// Cmd/Ctrl+F semantics): move focus elsewhere, type a value, press the
	// shortcut again, then type one character — if the prior value was
	// selected, that keystroke replaces it entirely rather than appending.
	await searchInput.fill("stale-query");
	await page.locator(".plain-search-view-replace-input").focus();
	await page.keyboard.press("ControlOrMeta+Shift+F");
	await expect(searchInput).toBeFocused();
	await page.keyboard.type("x");
	await expect(searchInput).toHaveValue("x");

	// Both commands appear in and are executable from the Command Palette —
	// "Search: Find in Files" re-focuses the search input, "Search: Replace
	// in Files" moves focus to the replace input.
	await executePaletteCommand(page, "Find in Files", "Search: Find in Files");
	await expect(searchInput).toBeFocused();
	await executePaletteCommand(
		page,
		"Replace in Files",
		"Search: Replace in Files",
	);
	await expect(page.locator(".plain-search-view-replace-input")).toBeFocused();

	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("Cmd/Ctrl+Shift+H opens the Search view and focuses the replace input with select-all semantics", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	await installNativeIpcMock(page, "arrayBuffer", "supported");
	await openNativeWorkspaceExplorer(page);

	await page.keyboard.press("ControlOrMeta+Shift+H");
	const replaceInput = page.locator(".plain-search-view-replace-input");
	await expect(replaceInput).toBeVisible();
	await expect(replaceInput).toBeFocused();

	// Same repeat-invocation select-all semantics as Cmd/Ctrl+Shift+F above,
	// targeting the replace input instead.
	await replaceInput.fill("stale-replacement");
	await page.locator(".plain-search-view-input").focus();
	await page.keyboard.press("ControlOrMeta+Shift+H");
	await expect(replaceInput).toBeFocused();
	await page.keyboard.type("y");
	await expect(replaceInput).toHaveValue("y");

	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

async function lastTextSearchStartRequest(
	page: Page,
): Promise<Record<string, unknown>> {
	const calls = await page.evaluate(
		() =>
			(
				window as unknown as {
					__PLAIN_TEST_TAURI_CALLS__: readonly {
						command: string;
						args: Record<string, unknown>;
					}[];
				}
			).__PLAIN_TEST_TAURI_CALLS__,
	);
	const starts = calls.filter(
		(call) => call.command === "workspace_search_text_start",
	);
	const last = starts.at(-1);
	if (last === undefined) {
		throw new Error("no workspace_search_text_start call was recorded yet");
	}
	return last.args.request as Record<string, unknown>;
}

test("toggling Match Case and Match Whole Word sends the correct isCaseSensitive/isWordMatch request flags and narrows the result set accordingly", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	// Two files distinguished only by case, and two files distinguished only
	// by whether "cat" is a whole word or a substring of "category" — lets a
	// single toggle flip change which file group appears without changing the
	// query text itself.
	await installNativeIpcMock(page, "arrayBuffer", "supported", {
		"toggle-fixture/case-upper.txt": "Needle appears here\n",
		"toggle-fixture/case-lower.txt": "needle appears here\n",
		"toggle-fixture/word-substring.txt": "category appears here\n",
		"toggle-fixture/word-whole.txt": "cat appears here\n",
	});
	await openNativeWorkspaceExplorer(page);

	await page.getByRole("tab", { name: /^Search/ }).click();
	const searchInput = page.locator(".plain-search-view-input");
	await expect(searchInput).toBeVisible();
	const status = page.locator(".plain-search-view-status");
	const fileGroups = page.locator(".plain-search-view-file");
	const caseToggle = page.locator(".plain-search-view-case-toggle");
	const wordToggle = page.locator(".plain-search-view-word-toggle");
	await expect(caseToggle).toHaveAttribute("aria-pressed", "false");
	await expect(wordToggle).toHaveAttribute("aria-pressed", "false");

	// Case-insensitive (default off) finds both differently-cased files.
	await searchInput.pressSequentially("needle");
	await expect(status).toHaveText("2 results in 2 files", { timeout: 5_000 });
	await expect(lastTextSearchStartRequest(page)).resolves.toMatchObject({
		isCaseSensitive: false,
		isWordMatch: false,
	});

	// Toggling Match Case reruns the already-present query automatically and
	// narrows to only the exact-case file.
	await caseToggle.click();
	await expect(caseToggle).toHaveAttribute("aria-pressed", "true");
	await expect(status).toHaveText("1 result in 1 file", { timeout: 5_000 });
	await expect(lastTextSearchStartRequest(page)).resolves.toMatchObject({
		isCaseSensitive: true,
		isWordMatch: false,
	});
	await expect(
		fileGroups.filter({ hasText: "toggle-fixture/case-lower.txt" }),
	).toHaveCount(1);
	await expect(
		fileGroups.filter({ hasText: "toggle-fixture/case-upper.txt" }),
	).toHaveCount(0);

	// Turning Match Case back off restores the case-insensitive result set.
	await caseToggle.click();
	await expect(caseToggle).toHaveAttribute("aria-pressed", "false");
	await expect(status).toHaveText("2 results in 2 files", { timeout: 5_000 });

	// Whole-word: with the toggle off, "cat" matches both the substring
	// inside "category" and the standalone word.
	await searchInput.fill("");
	await searchInput.pressSequentially("cat");
	await expect(status).toHaveText("2 results in 2 files", { timeout: 5_000 });
	await expect(lastTextSearchStartRequest(page)).resolves.toMatchObject({
		isCaseSensitive: false,
		isWordMatch: false,
	});

	await wordToggle.click();
	await expect(wordToggle).toHaveAttribute("aria-pressed", "true");
	await expect(status).toHaveText("1 result in 1 file", { timeout: 5_000 });
	await expect(lastTextSearchStartRequest(page)).resolves.toMatchObject({
		isCaseSensitive: false,
		isWordMatch: true,
	});
	await expect(
		fileGroups.filter({ hasText: "toggle-fixture/word-whole.txt" }),
	).toHaveCount(1);
	await expect(
		fileGroups.filter({ hasText: "toggle-fixture/word-substring.txt" }),
	).toHaveCount(0);

	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("case-sensitivity and whole-word toggles default off, matching pre-F200 case-insensitive substring behavior exactly", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	await installNativeIpcMock(page, "arrayBuffer", "supported", {
		"regression/mixed-case.txt": "Needle line\n",
		"regression/substring.txt": "categorization\n",
	});
	await openNativeWorkspaceExplorer(page);

	await page.getByRole("tab", { name: /^Search/ }).click();
	const searchInput = page.locator(".plain-search-view-input");
	await expect(searchInput).toBeVisible();
	const status = page.locator(".plain-search-view-status");
	const fileGroups = page.locator(".plain-search-view-file");
	await expect(page.locator(".plain-search-view-case-toggle")).toHaveAttribute(
		"aria-pressed",
		"false",
	);
	await expect(page.locator(".plain-search-view-word-toggle")).toHaveAttribute(
		"aria-pressed",
		"false",
	);

	// Lowercase "needle" still matches the differently-cased file, exactly
	// like every pre-F200 search (no accidental default case sensitivity).
	await searchInput.pressSequentially("needle");
	await expect(status).toHaveText("1 result in 1 file", { timeout: 5_000 });
	await expect(
		fileGroups.filter({ hasText: "regression/mixed-case.txt" }),
	).toHaveCount(1);

	// "cat" still matches as a substring inside "categorization", exactly
	// like every pre-F200 search (no accidental default word-boundary
	// narrowing).
	await searchInput.fill("");
	await searchInput.pressSequentially("cat");
	await expect(status).toHaveText("1 result in 1 file", { timeout: 5_000 });
	await expect(
		fileGroups.filter({ hasText: "regression/substring.txt" }),
	).toHaveCount(1);

	const calls = await page.evaluate(
		() =>
			(
				window as unknown as {
					__PLAIN_TEST_TAURI_CALLS__: readonly {
						command: string;
						args: Record<string, unknown>;
					}[];
				}
			).__PLAIN_TEST_TAURI_CALLS__,
	);
	const starts = calls.filter(
		(call) => call.command === "workspace_search_text_start",
	);
	expect(starts.length).toBeGreaterThanOrEqual(2);
	for (const call of starts) {
		expect(call.args.request).toMatchObject({
			isCaseSensitive: false,
			isWordMatch: false,
		});
	}

	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

// --- F200 S2: capture-group replacement expansion (docs/research/2026-08-04-complete-search.md "架构裁定 2") ---

test("Replace All with a capture-group template ($2-$1) transforms every match exactly, for both an already-open and an unopened file", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	await installNativeIpcMock(page, "arrayBuffer", "supported", {
		"swap-open.txt": "item-42 stays put\n",
		"swap-closed.txt": "value-7 alone\n",
	});
	const explorer = await openNativeWorkspaceExplorer(page);

	// One file is already open before the search+replace even starts (proves
	// the capture-group-expanded edit both reuses an already-resolved, live
	// editor model *and* resolves a never-opened one for the first time),
	// mirroring the plain (non-template) replace test's own precedent above.
	await explorer
		.getByRole("treeitem", { name: "swap-open.txt", exact: true })
		.dblclick();
	await expect(
		page.getByRole("code").filter({ hasText: "item-42 stays put" }),
	).toBeVisible();

	await page.getByRole("tab", { name: /^Search/ }).click();
	const searchInput = page.locator(".plain-search-view-input");
	const replaceInput = page.locator(".plain-search-view-replace-input");
	const status = page.locator(".plain-search-view-status");
	const messages = page.locator(".plain-search-view-messages");
	const fileGroups = page.locator(".plain-search-view-file");

	await page.locator(".plain-search-view-regex-toggle").check();
	await searchInput.pressSequentially(String.raw`(\w+)-(\d+)`);
	await expect(status).toHaveText("2 results in 2 files", { timeout: 5_000 });
	await expect(fileGroups).toHaveCount(2);

	await replaceInput.fill("$2-$1");
	await page.locator(".plain-search-view-replace-all").click();

	await expect(fileGroups).toHaveCount(0, { timeout: 5_000 });
	await expect(messages).toHaveText("Replaced 2 matches.");

	// The already-open editor's live buffer reflects the capture-group swap
	// and is clean again (saved, not just edited in memory).
	await expect(
		page.getByRole("code").filter({ hasText: "42-item stays put" }),
	).toBeVisible();
	const activeTab = page.locator(".tabs-container .tab.active");
	await expect(activeTab).not.toHaveClass(/dirty/);

	const writes = await nativeWriteFileCalls(page);
	expect(writes).toHaveLength(2);
	const byPath = new Map(
		writes.map((write) => [write.request.relativePath, write.contentHex]),
	);
	expect(byPath.get("swap-open.txt")).toBe(hexOfText("42-item stays put\n"));
	expect(byPath.get("swap-closed.txt")).toBe(hexOfText("7-value alone\n"));

	// The expansion itself routed through Rust's single regex authority
	// (`workspace_search_expand_replacements`), not a parallel JS `RegExp`
	// implementation in the Workbench.
	const expandCalls = await nativeCallsFor(
		page,
		"workspace_search_expand_replacements",
	);
	expect(expandCalls.length).toBeGreaterThanOrEqual(1);
	for (const call of expandCalls) {
		expect(call.args.request).toMatchObject({
			isRegExp: true,
			replacementTemplate: "$2-$1",
		});
	}

	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("an out-of-range capture group in the template degrades the whole file to a zero-write conflict with the standard Reload/Save As/Details UI", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	await installNativeIpcMock(page, "arrayBuffer", "supported", {
		"single-group.txt": "uniqueneedle123 stays\n",
	});
	await openNativeWorkspaceExplorer(page);

	await page.getByRole("tab", { name: /^Search/ }).click();
	const searchInput = page.locator(".plain-search-view-input");
	const replaceInput = page.locator(".plain-search-view-replace-input");
	const status = page.locator(".plain-search-view-status");
	const messages = page.locator(".plain-search-view-messages");
	const fileGroups = page.locator(".plain-search-view-file");

	// The pattern has exactly one capture group; the template references a
	// second one that does not exist. A distinctive literal keyword (rather
	// than a broad `\w+`) keeps this match unique across the whole fixture
	// tree `installNativeIpcMock` already populates.
	await page.locator(".plain-search-view-regex-toggle").check();
	await searchInput.pressSequentially("(uniqueneedle123)");
	await expect(status).toHaveText("1 result in 1 file", { timeout: 5_000 });

	await replaceInput.fill("$1-$2");
	await page.locator(".plain-search-view-replace-all").click();

	// Zero-write conflict, not a partial rewrite: the file's group and match
	// both remain, with the exact same pre-flight-conflict UI (never a real
	// save attempt) the stale-search-coordinates test above already
	// establishes — reusing that same `{ status: "conflict" }` branch is the
	// frozen "复用既有冲突分支" decision, so the notification text is
	// necessarily the generic "file changed on disk" wording even though the
	// real cause here is an out-of-range capture group, not an actual
	// on-disk change.
	await expect(fileGroups).toHaveCount(1, { timeout: 5_000 });
	await expect(
		fileGroups
			.filter({ hasText: "single-group.txt" })
			.locator(".plain-search-view-file-error"),
	).toContainText("failed to save");
	await expect(messages).toHaveText("1 replacement failed to save.");

	const toasts = page.locator(".notifications-toasts .notification-toast");
	await expect(toasts).toHaveCount(1);
	await expect(toasts.first()).toContainText(
		"The file changed on disk after these search results were produced.",
	);
	await expect(
		toasts.first().getByRole("button", { name: "Reload", exact: true }),
	).toHaveCount(1);
	await expect(
		toasts.first().getByRole("button", { name: "Save As...", exact: true }),
	).toHaveCount(1);
	await expect(
		toasts.first().getByRole("button", { name: "Retry", exact: true }),
	).toHaveCount(0);

	const writes = await nativeWriteFileCalls(page);
	expect(writes).toHaveLength(0);

	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([
		"Failed to replace 'single-group.txt'. The file changed on disk after these search results were produced.",
	]);
});

test("literal (non-regex) mode still applies replacement text containing $1 completely verbatim, byte-for-byte", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	await installNativeIpcMock(page, "arrayBuffer", "supported", {
		"literal-dollar.txt": "needle here\n",
	});
	await openNativeWorkspaceExplorer(page);

	await page.getByRole("tab", { name: /^Search/ }).click();
	const searchInput = page.locator(".plain-search-view-input");
	const replaceInput = page.locator(".plain-search-view-replace-input");
	const status = page.locator(".plain-search-view-status");
	const messages = page.locator(".plain-search-view-messages");

	// The regex checkbox is left unchecked — this is a plain literal search.
	await searchInput.pressSequentially("needle");
	await expect(status).toHaveText("1 result in 1 file", { timeout: 5_000 });

	await replaceInput.fill("$1 literal, not a group");
	await page.locator(".plain-search-view-replace-all").click();

	await expect(messages).toHaveText("Replaced 1 match.");

	const writes = await nativeWriteFileCalls(page);
	expect(writes).toHaveLength(1);
	expect(writes[0]!.request.relativePath).toBe("literal-dollar.txt");
	expect(writes[0]!.contentHex).toBe(
		hexOfText("$1 literal, not a group here\n"),
	);

	// Literal mode never calls the capture-group expansion command at all.
	const expandCalls = await nativeCallsFor(
		page,
		"workspace_search_expand_replacements",
	);
	expect(expandCalls).toHaveLength(0);

	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("Match Case and Match Whole Word toggles combine correctly with capture-group replacement", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	await installNativeIpcMock(page, "arrayBuffer", "supported", {
		"combo.txt": "Cat-1 concatenate-9 cat-2\n",
	});
	await openNativeWorkspaceExplorer(page);

	await page.getByRole("tab", { name: /^Search/ }).click();
	const searchInput = page.locator(".plain-search-view-input");
	const replaceInput = page.locator(".plain-search-view-replace-input");
	const status = page.locator(".plain-search-view-status");
	const messages = page.locator(".plain-search-view-messages");

	await page.locator(".plain-search-view-regex-toggle").check();
	await page.locator(".plain-search-view-case-toggle").click();
	await page.locator(".plain-search-view-word-toggle").click();
	await expect(page.locator(".plain-search-view-case-toggle")).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect(page.locator(".plain-search-view-word-toggle")).toHaveAttribute(
		"aria-pressed",
		"true",
	);

	// Case-sensitive + whole-word: matches only the standalone lowercase
	// "cat-2" word — not "Cat-1" (wrong case) and not the "cat" substring
	// buried inside "concatenate-9" (not a whole word).
	await searchInput.pressSequentially(String.raw`(cat)-(\d+)`);
	await expect(status).toHaveText("1 result in 1 file", { timeout: 5_000 });

	await replaceInput.fill("$2-$1");
	await page.locator(".plain-search-view-replace-all").click();
	await expect(messages).toHaveText("Replaced 1 match.");

	const writes = await nativeWriteFileCalls(page);
	expect(writes).toHaveLength(1);
	expect(writes[0]!.contentHex).toBe(hexOfText("Cat-1 concatenate-9 2-cat\n"));

	// The expand-replacements request carried the same case/word flags the
	// search itself used, not the defaults.
	const expandCalls = await nativeCallsFor(
		page,
		"workspace_search_expand_replacements",
	);
	expect(expandCalls.length).toBeGreaterThanOrEqual(1);
	for (const call of expandCalls) {
		expect(call.args.request).toMatchObject({
			isCaseSensitive: true,
			isWordMatch: true,
		});
	}

	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

// --- F200 S3: regex capability backing, skipped/truncated visibility, undo ---
// (docs/research/2026-08-04-complete-search.md "架构裁定 §4/§5") ---------------

test("shows an accurate, path-free error for each PCRE2-only regex construct (lookahead, lookbehind, backreference)", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	await installNativeIpcMock(page, "arrayBuffer", "supported");
	await openNativeWorkspaceExplorer(page);

	await page.getByRole("tab", { name: /^Search/ }).click();
	const searchInput = page.locator(".plain-search-view-input");
	const messages = page.locator(".plain-search-view-messages");
	await page.locator(".plain-search-view-regex-toggle").check();

	// The exact same three PCRE2-only constructs
	// `text_search.rs`'s own `regex_pcre2_only_constructs_are_rejected_per_
	// construct_with_a_path_free_message` Rust test backs directly (lookahead,
	// lookbehind, backreference) — this proves the same capability boundary is
	// visible end-to-end through the actual Search view UI (reusing the
	// existing invalid-regex message path the "(unclosed" case already
	// exercises above), not only at the Rust layer.
	for (const pattern of ["foo(?=bar)", "(?<=foo)bar", String.raw`(foo)\1`]) {
		await searchInput.fill("");
		await searchInput.pressSequentially(pattern);
		await expect(messages).not.toHaveText("", { timeout: 5_000 });
		await expect(messages).toContainText("regular expression");
		const text = (await messages.textContent())?.trim() ?? "";
		expect(text.length).toBeGreaterThan(0);
		expect(text).not.toContain("/");
	}

	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("shows an accurate 'Skipped N files' message covering both binary and oversized files, excluding them from results", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	// `textSearchMaxFileSizeForTest` (100 bytes) sits comfortably above every
	// byte length in the fixed base fixture this mock always seeds (README.md
	// 48 bytes, notes.md 59, src/main.ts 27, icon.png 68 — see this file's own
	// `MINIMAL_PNG_BASE64` doc comment: a genuine binary PNG, deliberately
	// flagged `seemsBinary`) but well below this test's own 158-byte
	// `skip-oversized.txt`, so exactly one of each skip reason is produced:
	// `icon.png` supplies the binary skip (no separate NUL-byte fixture
	// needed) and `skip-oversized.txt` supplies the oversize skip. Every
	// positional argument between `extraFiles` and the trailing lever below
	// is spelled out at its own documented default — `installNativeIpcMock`
	// has no named-parameter form.
	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"supported",
		{
			"skip-normal.txt": "needle stays visible\n",
			"skip-oversized.txt": `needle ${"x".repeat(150)}\n`,
		},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		false,
		{},
		{},
		{},
		{},
		[],
		0,
		0,
		100,
	);
	await openNativeWorkspaceExplorer(page);

	await page.getByRole("tab", { name: /^Search/ }).click();
	const searchInput = page.locator(".plain-search-view-input");
	const status = page.locator(".plain-search-view-status");
	const messages = page.locator(".plain-search-view-messages");

	await searchInput.pressSequentially("needle");
	await expect(status).toHaveText("1 result in 1 file", { timeout: 5_000 });
	await expect(messages).toHaveText(
		"Skipped 1 binary and 1 oversized file(s).",
	);

	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("undoes a plain Replace All in an already-open editor, restoring the pre-replace text without touching a sibling file's replacement", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	await installNativeIpcMock(page, "arrayBuffer", "supported", {
		"undo-a.txt": "needle one\n",
		"undo-b.txt": "needle two\n",
	});
	const explorer = await openNativeWorkspaceExplorer(page);

	// Both files are already open (in separate tabs) before the replace even
	// starts — this is what makes "undo in the live editor buffer" a
	// meaningful thing to assert at all (an unopened file is only ever
	// touched on disk; there is no editor buffer to undo).
	await explorer
		.getByRole("treeitem", { name: "undo-a.txt", exact: true })
		.dblclick();
	await expect(
		page.getByRole("code").filter({ hasText: "needle one" }),
	).toBeVisible();
	await explorer
		.getByRole("treeitem", { name: "undo-b.txt", exact: true })
		.dblclick();
	await expect(
		page.getByRole("code").filter({ hasText: "needle two" }),
	).toBeVisible();

	await page.getByRole("tab", { name: /^Search/ }).click();
	const searchInput = page.locator(".plain-search-view-input");
	const replaceInput = page.locator(".plain-search-view-replace-input");
	const status = page.locator(".plain-search-view-status");
	const messages = page.locator(".plain-search-view-messages");

	await searchInput.pressSequentially("needle");
	await expect(status).toHaveText("2 results in 2 files", { timeout: 5_000 });

	await replaceInput.fill("cactus");
	await page.locator(".plain-search-view-replace-all").click();
	await expect(messages).toHaveText("Replaced 2 matches.");

	// Undo semantics are frozen as one independent undo entry per file (see
	// `plain-replace-coordinator.ts`'s own doc comment and
	// `docs/research/2026-08-04-complete-search.md` "架构裁定 §3") — switch to
	// the second file's tab, undo there, and confirm both halves of that
	// contract: the undone file's content reverts, and the sibling file's own
	// already-saved replacement is completely untouched.
	const undoBTab = page.locator(".tabs-container .tab", {
		hasText: "undo-b.txt",
	});
	await undoBTab.click();
	await expect(
		page.getByRole("code").filter({ hasText: "cactus two" }),
	).toBeVisible();
	await page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "cactus two" })
		.click();
	await page.keyboard.press("ControlOrMeta+Z");

	await expect(
		page.getByRole("code").filter({ hasText: "needle two" }),
	).toBeVisible();
	await expect(
		page.getByRole("code").filter({ hasText: "cactus two" }),
	).toHaveCount(0);
	await expect(undoBTab).toHaveClass(/dirty/);

	const undoATab = page.locator(".tabs-container .tab", {
		hasText: "undo-a.txt",
	});
	await undoATab.click();
	await expect(
		page.getByRole("code").filter({ hasText: "cactus one" }),
	).toBeVisible();
	await expect(undoATab).not.toHaveClass(/dirty/);

	// The undo is a local buffer edit, not a new save — still exactly the two
	// writes the original Replace All produced.
	const writes = await nativeWriteFileCalls(page);
	expect(writes).toHaveLength(2);

	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("undoes a capture-group template Replace All in an already-open editor, restoring the exact pre-replace text", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});
	await installNativeIpcMock(page, "arrayBuffer", "supported", {
		"undo-swap.txt": "item-42 stays put\n",
	});
	const explorer = await openNativeWorkspaceExplorer(page);

	await explorer
		.getByRole("treeitem", { name: "undo-swap.txt", exact: true })
		.dblclick();
	await expect(
		page.getByRole("code").filter({ hasText: "item-42 stays put" }),
	).toBeVisible();

	await page.getByRole("tab", { name: /^Search/ }).click();
	const searchInput = page.locator(".plain-search-view-input");
	const replaceInput = page.locator(".plain-search-view-replace-input");
	const status = page.locator(".plain-search-view-status");
	const messages = page.locator(".plain-search-view-messages");

	await page.locator(".plain-search-view-regex-toggle").check();
	await searchInput.pressSequentially(String.raw`(\w+)-(\d+)`);
	await expect(status).toHaveText("1 result in 1 file", { timeout: 5_000 });

	await replaceInput.fill("$2-$1");
	await page.locator(".plain-search-view-replace-all").click();
	await expect(messages).toHaveText("Replaced 1 match.");
	await expect(
		page.getByRole("code").filter({ hasText: "42-item stays put" }),
	).toBeVisible();

	const activeTab = page.locator(".tabs-container .tab.active");
	await page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "42-item stays put" })
		.click();
	await page.keyboard.press("ControlOrMeta+Z");

	// The capture-group-expanded replacement text is undone back to the exact
	// original source (not the template, not a partial revert) — proving undo
	// works uniformly regardless of which replacement path (literal vs.
	// Rust-expanded template) produced the edit.
	await expect(
		page.getByRole("code").filter({ hasText: "item-42 stays put" }),
	).toBeVisible();
	await expect(
		page.getByRole("code").filter({ hasText: "42-item stays put" }),
	).toHaveCount(0);
	await expect(activeTab).toHaveClass(/dirty/);

	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

async function workbenchThemeState(
	page: Page,
): Promise<{ classNames: readonly string[]; editorBackground: string }> {
	return page.evaluate(() => {
		const workbench = document.querySelector(".monaco-workbench");
		if (workbench === null) {
			throw new Error("'.monaco-workbench' element is missing");
		}
		return {
			classNames: [...workbench.classList],
			editorBackground: getComputedStyle(workbench)
				.getPropertyValue("--vscode-editor-background")
				.trim(),
		};
	});
}

// The 10 built-in theme-defaults themes' real, upstream-translated labels
// (see app/features/themes/plain-theme-registry.ts's own doc comment on why
// the raw manifest.contributes.themes[].label only ever holds an untranslated
// `%key%` NLS placeholder before this feature resolves it) and each one's
// exact `ColorThemeData#classNames` fragment (`toCSSSelector`'s
// `${extensionId}-${themePath}` half of `id`, see plain-theme-registry.ts) —
// frozen here so a regression in either resolution or class-naming shows up
// as a concrete, named mismatch rather than a generic count failure.
// Unlike executePaletteCommand's other call sites, accepting the "Preferences:
// Color Theme" palette entry does not close the quick input widget at all —
// Plain's own command handler (see app/features/themes/plain-theme-picker.ts)
// synchronously opens a second quick pick (the theme picker itself) in the
// very same `.quick-input-widget` DOM node, so it is never actually hidden
// in between. executePaletteCommand's own `toBeHidden` postcondition would
// therefore time out; this waits for the theme picker's own placeholder
// instead of a hide/show transition that never happens.
async function openColorThemePicker(page: Page): Promise<Locator> {
	await page.keyboard.press("ControlOrMeta+Shift+P");
	const picker = page.locator(".quick-input-widget");
	await expect(picker).toBeVisible();
	await picker.locator("input").pressSequentially("Color Theme");
	const paletteCommand = picker.getByText("Preferences: Color Theme", {
		exact: true,
	});
	await expect(paletteCommand).toHaveCount(1);
	await paletteCommand.click();
	await expect(picker.locator("input")).toHaveAttribute(
		"placeholder",
		"Select Color Theme",
	);
	return picker;
}

const BUILT_IN_THEMES = Object.freeze([
	{
		label: "Dark 2026",
		className: "vscode-theme-defaults-themes-2026-dark-json",
	},
	{ label: "Dark+", className: "vscode-theme-defaults-themes-dark_plus-json" },
	{
		label: "Dark Modern",
		className: "vscode-theme-defaults-themes-dark_modern-json",
	},
	{
		label: "Dark",
		className: "vscode-theme-defaults-themes-dark_vs-json",
	},
	{
		label: "Light 2026",
		className: "vscode-theme-defaults-themes-2026-light-json",
	},
	{
		label: "Light+",
		className: "vscode-theme-defaults-themes-light_plus-json",
	},
	{
		label: "Light Modern",
		className: "vscode-theme-defaults-themes-light_modern-json",
	},
	{
		label: "Light",
		className: "vscode-theme-defaults-themes-light_vs-json",
	},
	{
		label: "Dark High Contrast",
		className: "vscode-theme-defaults-themes-hc_black-json",
	},
	{
		label: "Light High Contrast",
		className: "vscode-theme-defaults-themes-hc_light-json",
	},
] as const);

function builtInTheme(label: string): (typeof BUILT_IN_THEMES)[number] {
	const theme = BUILT_IN_THEMES.find((candidate) => candidate.label === label);
	if (theme === undefined) {
		throw new Error(`unknown fixture theme label: ${label}`);
	}
	return theme;
}

const DARK_MODERN = builtInTheme("Dark Modern");

test("boots on the real, loaded Dark Modern theme instead of the unthemed placeholder", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	// Before this feature, the Workbench booted on
	// `ColorThemeData.createUnloadedThemeForThemeType`'s bare placeholder:
	// `.monaco-workbench` carried only the generic `vs` class and
	// `--vscode-editor-background` was empty. Both are now real.
	const state = await workbenchThemeState(page);
	expect(state.classNames).toEqual(
		expect.arrayContaining(["vs-dark", DARK_MODERN.className]),
	);
	expect(state.classNames).not.toContain("vs");
	expect(state.editorBackground).toBe("#1f1f1f");

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("lists all 10 built-in themes in their exact grouped order in the Color Theme quick pick", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	const picker = await openColorThemePicker(page);

	const pickerRows = picker.locator(".quick-input-list .monaco-list-row");
	await expect(pickerRows).toHaveCount(BUILT_IN_THEMES.length);
	for (const { label } of BUILT_IN_THEMES) {
		await expect(pickerRows.getByText(label, { exact: true })).toHaveCount(1);
	}

	// The currently active theme (Dark Modern, the bootstrap default) is
	// pre-selected as the active/focused item, exactly like upstream's own
	// picker pre-selects the current theme.
	const focusedRow = picker.locator(
		".quick-input-list .monaco-list-row.focused",
	);
	await expect(focusedRow).toHaveCount(1);
	await expect(focusedRow).toContainText("Dark Modern");

	const darkModernIndex = BUILT_IN_THEMES.findIndex(
		({ label }) => label === "Dark Modern",
	);
	// Move to the very first row, then arrow-down through every remaining
	// one: this proves the exact bucketed order (dark, then light, then
	// high contrast — each bucket preserving the manifest's own contributed
	// order, see plain-theme-picker.ts's own doc comment), not just that 10
	// unordered rows with the right labels exist.
	for (let step = 0; step < darkModernIndex; step += 1) {
		await page.keyboard.press("ArrowUp");
	}
	for (const [index, { label }] of BUILT_IN_THEMES.entries()) {
		await expect(focusedRow.locator(".label-name")).toHaveText(label);
		if (index < BUILT_IN_THEMES.length - 1) {
			await page.keyboard.press("ArrowDown");
		}
	}

	await page.keyboard.press("Escape");
	await expect(picker).toBeHidden();

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("previews a theme live on navigation, restores on Escape, and applies for real on Enter", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	const originalState = await workbenchThemeState(page);
	expect(originalState.classNames).toContain(DARK_MODERN.className);

	const picker = await openColorThemePicker(page);
	const focusedRow = picker.locator(
		".quick-input-list .monaco-list-row.focused",
	);
	await expect(focusedRow).toContainText("Dark Modern");

	// Navigating to a Light theme applies it immediately, live, without
	// closing the picker or waiting for Enter — a real preview, not a
	// simulated one.
	const lightPlus = builtInTheme("Light+");
	const darkModernIndex = BUILT_IN_THEMES.findIndex(
		({ label }) => label === "Dark Modern",
	);
	const lightPlusIndex = BUILT_IN_THEMES.findIndex(
		({ label }) => label === "Light+",
	);
	for (let step = 0; step < lightPlusIndex - darkModernIndex; step += 1) {
		await page.keyboard.press("ArrowDown");
	}
	await expect(focusedRow).toContainText("Light+");
	await expect
		.poll(async () => (await workbenchThemeState(page)).editorBackground)
		.toBe("#ffffff");
	const previewState = await workbenchThemeState(page);
	expect(previewState.classNames).toContain(lightPlus.className);
	expect(previewState.classNames).toContain("vs");

	// Escape restores exactly the theme that was active before the picker
	// opened — not merely "some" theme.
	await page.keyboard.press("Escape");
	await expect(picker).toBeHidden();
	const afterEscapeState = await workbenchThemeState(page);
	// Set equality, not array equality: `F060` S2's own `file-icons-enabled`
	// class is added once at bootstrap and never touched again by a color
	// theme restore, but `WorkbenchThemeService.applyAndSetColorTheme`'s own
	// `classList.remove(...)`/`classList.add(...)` pair (see
	// `workbenchThemeService.js`) always re-appends the *color* theme's own
	// classes at the end of `.monaco-workbench`'s `DOMTokenList` — which
	// shifts `file-icons-enabled`'s position among the reported class names
	// relative to them without changing which classes are actually present.
	// `classList` order has no CSS meaning (specificity, not attribute
	// order, decides which rules apply), so comparing as sets is the
	// faithful assertion here, not an order-sensitive array `toEqual`.
	expect([...afterEscapeState.classNames].sort()).toEqual(
		[...originalState.classNames].sort(),
	);
	expect(afterEscapeState.editorBackground).toBe(
		originalState.editorBackground,
	);

	// Reopening (through the action's own configured keychord this time, not
	// the palette) and accepting a different theme with Enter applies it for
	// real: it must still be in effect after the picker itself has closed.
	await page.keyboard.press("ControlOrMeta+K");
	await page.keyboard.press("ControlOrMeta+T");
	await expect(picker.locator("input")).toBeVisible();
	const lightModern = builtInTheme("Light Modern");
	const lightModernIndex = BUILT_IN_THEMES.findIndex(
		({ label }) => label === "Light Modern",
	);
	for (let step = 0; step < lightModernIndex - darkModernIndex; step += 1) {
		await page.keyboard.press("ArrowDown");
	}
	await expect(focusedRow).toContainText("Light Modern");
	await page.keyboard.press("Enter");
	await expect(picker).toBeHidden();
	// The picker hiding is NOT a barrier for "the accepted theme is fully
	// applied": `QuickPick.accept()` hides the widget synchronously while
	// `WorkbenchThemeService.applyAndSetColorTheme` finishes asynchronously.
	// Sampling `workbenchThemeState` immediately after `toBeHidden()` was a
	// real race — reproduced at 1 failure in 6 isolated repeats, always on
	// the `classNames` assertion below, never on the focus assertion above.
	// It had previously been written off twice as "pre-existing environmental
	// flakiness". Poll for the applied class the same way the live-preview
	// half of this test already polls for `editorBackground`, then snapshot
	// once for the remaining assertions.
	await expect
		.poll(async () => (await workbenchThemeState(page)).classNames)
		.toContain(lightModern.className);
	const appliedState = await workbenchThemeState(page);
	expect(appliedState.classNames).toContain(lightModern.className);
	expect(appliedState.editorBackground).toBe("#ffffff");

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

// `F050` S3: a theme package "already imported" in a previous session (via
// `themeLibraryFixtureForTest`, standing in for `theme_list` returning a
// package Rust's own library already has on disk) must reappear in the
// picker at this session's own startup — and actually applying it must run
// the real `ColorThemeData`/`extension-file:` resource-loading path (a
// distinctive `editor.background`, not a stubbed value).
const IMPORTED_FANCY_DARK_FIXTURE = Object.freeze({
	summary: Object.freeze({
		id: "acme.fancy-dark@1.0.0",
		publisher: "acme",
		name: "fancy-dark",
		version: "1.0.0",
		themes: Object.freeze([
			Object.freeze({
				label: "My Fancy Dark",
				uiTheme: "vs-dark" as const,
				path: "themes/fancy-dark.json",
			}),
		]),
		iconThemes: Object.freeze([]),
		productIconThemes: Object.freeze([]),
		resources: Object.freeze(["themes/fancy-dark.json"]),
		containsCode: false,
	}),
	resourceContents: Object.freeze({
		"themes/fancy-dark.json": JSON.stringify({
			colors: { "editor.background": "#123456" },
		}),
	}),
});

// `F060` S3: a theme package that contributes a color theme, a file icon
// theme and a product icon theme together — closing the S2 gap where an
// imported package's icon themes were validated and stored by Rust but
// never projected onto the wire, so the frontend had no way to discover or
// apply them (see `docs/research/2026-07-24-icon-themes.md`'s "实施偏差记录").
const IMPORTED_FANCY_ICONS_FIXTURE = Object.freeze({
	summary: Object.freeze({
		id: "acme.fancy-icons@1.0.0",
		publisher: "acme",
		name: "fancy-icons",
		version: "1.0.0",
		themes: Object.freeze([
			Object.freeze({
				label: "Fancy Icons Theme",
				uiTheme: "vs-dark" as const,
				path: "themes/fancy-icons.json",
			}),
		]),
		iconThemes: Object.freeze([
			Object.freeze({
				id: "acme.fancy-file-icons",
				label: "Fancy File Icons",
				path: "fileicons/fancy-file-icons.json",
			}),
		]),
		productIconThemes: Object.freeze([
			Object.freeze({
				id: "acme.fancy-product-icons",
				label: "Fancy Product Icons",
				path: "picons/fancy-product-icons.json",
			}),
		]),
		resources: Object.freeze([
			"themes/fancy-icons.json",
			"fileicons/fancy-file-icons.json",
			"fileicons/fancy-file.svg",
			"picons/fancy-product-icons.json",
			"picons/fancy-font.woff",
		]),
		containsCode: false,
	}),
	resourceContents: Object.freeze({
		"themes/fancy-icons.json": JSON.stringify({
			colors: { "editor.background": "#654321" },
		}),
		"fileicons/fancy-file-icons.json": JSON.stringify({
			iconDefinitions: {
				_file: { iconPath: "./fancy-file.svg" },
			},
			file: "_file",
		}),
		"fileicons/fancy-file.svg":
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16"/></svg>',
		// `fonts` must be non-empty with a valid `id`/`src` (upstream's own
		// `_loadProductIconThemeDocument` rejects `{ iconDefinitions, fonts:
		// [] }` outright — "Must contain iconDefinitions and fonts" — real
		// browser probe, not assumed; mirrors F060 S1's own Rust validation,
		// which never accepts an empty `fonts[]` either).
		"picons/fancy-product-icons.json": JSON.stringify({
			iconDefinitions: {},
			fonts: [
				{
					id: "fancy-font",
					// Real, valid `fontWeightRegex`/`fontStyleRegex` values (see
					// `@codingame/monaco-vscode-api`'s `iconRegistry.ts`) — an
					// omitted or invalid weight/style still logs a genuine
					// `console.error` ("Invalid font weight/style ... Ignoring
					// setting"), confirmed by a real browser probe, not assumed.
					weight: "normal",
					style: "normal",
					src: [{ path: "./fancy-font.woff", format: "woff" }],
				},
			],
		}),
		"picons/fancy-font.woff": "wOFF-fake-bytes-for-test-fixture-only",
	}),
});

test("lists an already-imported theme package at startup and applies it for real", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	await installNativeIpcMock(page, "arrayBuffer", "readonly", {}, 20_000, 0, [
		IMPORTED_FANCY_DARK_FIXTURE,
	]);
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	const picker = await openColorThemePicker(page);
	const importedRow = picker
		.locator(".quick-input-list .monaco-list-row")
		.filter({ hasText: "My Fancy Dark" });
	await expect(importedRow).toHaveCount(1);
	await importedRow.click();
	await expect(picker).toBeHidden();

	await expect
		.poll(async () => (await workbenchThemeState(page)).editorBackground)
		.toBe("#123456");

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("imports a VSIX via the Command Palette, shows a success toast, and the theme appears in the picker", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[{ status: "imported", fixture: IMPORTED_FANCY_DARK_FIXTURE }],
	);
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	await executePaletteCommand(
		page,
		"Import Color Theme (VSIX)",
		"Plain: Import Color Theme (VSIX)...",
	);

	const toasts = page.locator(".notifications-toasts .notification-toast");
	await expect(toasts).toHaveCount(1);
	await expect(toasts.first()).toContainText("acme.fancy-dark@1.0.0");

	const picker = await openColorThemePicker(page);
	await expect(
		picker
			.locator(".quick-input-list .monaco-list-row")
			.filter({ hasText: "My Fancy Dark" }),
	).toHaveCount(1);
	await page.keyboard.press("Escape");
	await expect(picker).toBeHidden();

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("removes an imported theme package via the Command Palette and falls back to Dark Modern when it was active", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	await installNativeIpcMock(page, "arrayBuffer", "readonly", {}, 20_000, 0, [
		IMPORTED_FANCY_DARK_FIXTURE,
	]);
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	// Select the imported theme first, so removal has to fall back.
	const themePicker = await openColorThemePicker(page);
	await themePicker
		.locator(".quick-input-list .monaco-list-row")
		.filter({ hasText: "My Fancy Dark" })
		.click();
	await expect(themePicker).toBeHidden();
	await expect
		.poll(async () => (await workbenchThemeState(page)).editorBackground)
		.toBe("#123456");

	await page.keyboard.press("ControlOrMeta+Shift+P");
	const palette = page.locator(".quick-input-widget");
	await expect(palette).toBeVisible();
	await palette
		.locator("input")
		.pressSequentially("Remove Imported Color Theme");
	const removeCommand = palette.getByText(
		"Plain: Remove Imported Color Theme...",
		{ exact: true },
	);
	await expect(removeCommand).toHaveCount(1);
	await removeCommand.click();
	await expect(palette.locator("input")).toHaveAttribute(
		"placeholder",
		"Select an imported theme package to remove",
	);
	await palette
		.locator(".quick-input-list .monaco-list-row")
		.filter({ hasText: "acme.fancy-dark@1.0.0" })
		.click();

	const confirmDialog = page.getByRole("dialog");
	await expect(confirmDialog).toBeVisible();
	await expect(confirmDialog).toContainText("acme.fancy-dark@1.0.0");
	await confirmDialog
		.getByRole("button", { name: "Remove", exact: true })
		.click();
	await expect(confirmDialog).toHaveCount(0);

	const toasts = page.locator(".notifications-toasts .notification-toast");
	await expect(toasts).toHaveCount(1);
	await expect(toasts.first()).toContainText("acme.fancy-dark@1.0.0");

	await expect
		.poll(async () => (await workbenchThemeState(page)).editorBackground)
		.toBe("#1f1f1f");
	const fallbackState = await workbenchThemeState(page);
	expect(fallbackState.classNames).toContain(DARK_MODERN.className);

	// `F050` S4: the persisted selection must be cleared, not left pointing
	// at the now-removed package's theme — first the selection from
	// clicking "My Fancy Dark" above, then the clear on removal fallback.
	expect(await themeSetSelectionCalls(page)).toEqual(["My Fancy Dark", null]);

	const pickerAfterRemoval = await openColorThemePicker(page);
	await expect(
		pickerAfterRemoval
			.locator(".quick-input-list .monaco-list-row")
			.filter({ hasText: "My Fancy Dark" }),
	).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(pickerAfterRemoval).toBeHidden();

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("shows a desensitized error toast when importing a VSIX fails, without leaking the raw error code", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[
			{
				status: "failed",
				code: "THEME_PACKAGE_NO_THEMES",
				message:
					"The theme package does not declare any contributes.themes entries.",
			},
		],
	);
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	await executePaletteCommand(
		page,
		"Import Color Theme (VSIX)",
		"Plain: Import Color Theme (VSIX)...",
	);

	const toasts = page.locator(".notifications-toasts .notification-toast");
	await expect(toasts).toHaveCount(1);
	const toast = toasts.first();
	await expect(toast).toContainText(
		"the theme package does not contribute any color themes",
	);
	const text = await toast.innerText();
	expect(text).not.toContain("THEME_PACKAGE_NO_THEMES");

	expect(pageErrors).toEqual([]);
	// `NotificationsAlerts` mirrors every Error-severity toast to the console
	// (see the same, already-established precedent a few hundred lines above
	// for the permanent-delete failure toasts) — exactly one entry, matching
	// this same desensitized text, not the raw `THEME_PACKAGE_NO_THEMES` code.
	expect(consoleErrors).toHaveLength(1);
	expect(consoleErrors[0]).toContain(
		"the theme package does not contribute any color themes",
	);
	expect(consoleErrors[0]).not.toContain("THEME_PACKAGE_NO_THEMES");
});

/**
 * `F050` S4: cross-session persistence of the selected color theme.
 *
 * `F060` S3 fix: a `theme_set_selection` call now only ever carries the one
 * axis it actually changed (see `theme::selection`'s own module doc comment
 * on the per-field update contract) — so this must only count a call as
 * touching `field` when the exact request object carries that key, never
 * every `theme_set_selection` call regardless of which axis it was about.
 * The three axis-specific wrappers below share this one implementation.
 */
async function themeSetSelectionCallsForField(
	page: Page,
	field: "themeId" | "fileIconThemeId" | "productIconThemeId",
): Promise<readonly (string | null)[]> {
	return page.evaluate((field) => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		return testWindow.__PLAIN_TEST_TAURI_CALLS__
			.filter(
				({ command, args }) =>
					command === "theme_set_selection" &&
					typeof args.request === "object" &&
					args.request !== null &&
					field in (args.request as Record<string, unknown>),
			)
			.map(
				({ args }) =>
					(args.request as Record<string, string | null>)[field] ?? null,
			);
	}, field);
}

function themeSetSelectionCalls(
	page: Page,
): Promise<readonly (string | null)[]> {
	return themeSetSelectionCallsForField(page, "themeId");
}

function fileIconThemeSetSelectionCalls(
	page: Page,
): Promise<readonly (string | null)[]> {
	return themeSetSelectionCallsForField(page, "fileIconThemeId");
}

function productIconThemeSetSelectionCalls(
	page: Page,
): Promise<readonly (string | null)[]> {
	return themeSetSelectionCallsForField(page, "productIconThemeId");
}

test("boots directly on a theme whose id was already persisted from a previous session", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		"Light+",
	);
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	const lightPlus = builtInTheme("Light+");
	const state = await workbenchThemeState(page);
	expect(state.classNames).toContain(lightPlus.className);
	expect(state.classNames).not.toContain(DARK_MODERN.className);
	expect(state.editorBackground).toBe("#ffffff");

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("persists the accepted theme's settingsId via theme_set_selection", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	await installNativeIpcMock(page, "arrayBuffer");
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	expect(await themeSetSelectionCalls(page)).toEqual([]);

	const picker = await openColorThemePicker(page);
	const focusedRow = picker.locator(
		".quick-input-list .monaco-list-row.focused",
	);
	const darkModernIndex = BUILT_IN_THEMES.findIndex(
		({ label }) => label === "Dark Modern",
	);
	const lightPlusIndex = BUILT_IN_THEMES.findIndex(
		({ label }) => label === "Light+",
	);
	for (let step = 0; step < lightPlusIndex - darkModernIndex; step += 1) {
		await page.keyboard.press("ArrowDown");
	}
	await expect(focusedRow).toContainText("Light+");
	await page.keyboard.press("Enter");
	await expect(picker).toBeHidden();

	// `Light+`'s manifest `id` and its resolved display label are the exact
	// same string (see this file's own `BUILT_IN_THEMES`/upstream package.json
	// cross-reference), so this is unambiguously the persisted `settingsId`.
	expect(await themeSetSelectionCalls(page)).toEqual(["Light+"]);

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("falls back to Dark Modern with zero crash when the persisted selection id matches no known theme", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		"a-stale-theme-id-from-a-removed-package",
	);
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	const state = await workbenchThemeState(page);
	expect(state.classNames).toContain(DARK_MODERN.className);
	expect(state.editorBackground).toBe("#1f1f1f");

	// The stale id must be cleared (not left to keep triggering this same
	// fallback on every future boot).
	expect(await themeSetSelectionCalls(page)).toEqual([null]);

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

// `F060` S2: built-in file/product icon theme activation. Real-browser probe
// (recorded before this feature landed, not assumed): `.monaco-workbench`
// never carried the vendor's own `file-icons-enabled` class, and the
// `contributedFileIconTheme`/`contributedProductIconTheme` `<style>`
// elements the vendor's own `_applyRules` always creates in `<head>` stayed
// present-but-permanently-empty — the Workbench booted with file icons
// structurally disabled, exactly mirroring `F050`'s own "unloaded theme
// placeholder" root cause for color themes.

/** Reads the computed `::before` `background-image` of the `.monaco-icon-
 * label` belonging to the Explorer row whose visible name is `rowName` —
 * this is the exact CSS Plain's activated file icon theme targets (see
 * `fileIconThemeData.js`'s `.show-file-icons .file-icon::before`/`.folder-
 * icon::before`/`.rootfolder-icon::before` selectors), independent of
 * whichever specific icon-definition SVG a given row resolves to. */
async function explorerRowIconBackgroundImage(
	page: Page,
	rowName: string,
): Promise<string> {
	return page.evaluate((name) => {
		const rows = [...document.querySelectorAll(".monaco-list-row")];
		const row = rows.find(
			(candidate) =>
				candidate.querySelector(".label-name")?.textContent === name,
		);
		if (row === undefined) {
			throw new Error(`Explorer row not found: ${name}`);
		}
		const label = row.querySelector(".monaco-icon-label");
		if (label === null) {
			throw new Error(`icon label not found for Explorer row: ${name}`);
		}
		return getComputedStyle(label, "::before").backgroundImage;
	}, rowName);
}

async function explorerRowIconResourceText(
	page: Page,
	rowName: string,
): Promise<string> {
	return page.evaluate(async (name) => {
		const rows = [...document.querySelectorAll(".monaco-list-row")];
		const row = rows.find(
			(candidate) =>
				candidate.querySelector(".label-name")?.textContent === name,
		);
		if (row === undefined) {
			throw new Error(`Explorer row not found: ${name}`);
		}
		const label = row.querySelector(".monaco-icon-label");
		if (label === null) {
			throw new Error(`icon label not found for Explorer row: ${name}`);
		}
		const backgroundImage = getComputedStyle(label, "::before").backgroundImage;
		const match = /^url\(["']?(.*?)["']?\)$/.exec(backgroundImage);
		if (match?.[1] === undefined) {
			throw new Error(`Explorer icon is not a URL: ${backgroundImage}`);
		}
		return await (await fetch(match[1])).text();
	}, rowName);
}

test("renders the vs-minimal file icon theme on real Explorer file and folder icons", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	await installNativeIpcMock(page, "arrayBuffer");
	const explorer = await openNativeWorkspaceExplorer(page);
	await expect(
		explorer.getByRole("treeitem", { name: "README.md" }),
	).toBeVisible();

	const state = await workbenchThemeState(page);
	expect(state.classNames).toContain("file-icons-enabled");

	// A regular file, a regular folder, and the workspace root folder each
	// carry a distinct icon-definition in `vs-minimal`'s own JSON
	// (`file`/`folder`/`rootFolder`) — all three must resolve to a real,
	// non-empty background image, not merely one of them.
	for (const rowName of ["README.md", "src", "native-workspace"]) {
		const backgroundImage = await explorerRowIconBackgroundImage(page, rowName);
		expect(backgroundImage).not.toBe("none");
		expect(backgroundImage.length).toBeGreaterThan(0);
	}

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

async function openFileIconThemePicker(page: Page): Promise<Locator> {
	await page.keyboard.press("ControlOrMeta+Shift+P");
	const picker = page.locator(".quick-input-widget");
	await expect(picker).toBeVisible();
	await picker.locator("input").pressSequentially("File Icon Theme");
	const paletteCommand = picker.getByText("Preferences: File Icon Theme", {
		exact: true,
	});
	await expect(paletteCommand).toHaveCount(1);
	await paletteCommand.click();
	await expect(picker.locator("input")).toHaveAttribute(
		"placeholder",
		"Select File Icon Theme (Up/Down Keys to Preview)",
	);
	return picker;
}

test("lists vs-minimal and None in the File Icon Theme quick pick; None disables icons and switching back re-enables them", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	await installNativeIpcMock(page, "arrayBuffer");
	await openNativeWorkspaceExplorer(page);
	const originalBackgroundImage = await explorerRowIconBackgroundImage(
		page,
		"README.md",
	);
	expect(originalBackgroundImage).not.toBe("none");

	const picker = await openFileIconThemePicker(page);
	const pickerRows = picker.locator(".quick-input-list .monaco-list-row");
	await expect(pickerRows).toHaveCount(2);
	await expect(pickerRows.filter({ hasText: "None" })).toHaveCount(1);
	await expect(pickerRows.getByText("Minimal", { exact: true })).toHaveCount(1);

	// `vs-minimal` (Plain's own bootstrap default — see
	// `VS_MINIMAL_FILE_ICON_THEME_SETTINGS_ID`) is pre-selected as the
	// active/focused item, mirroring the Color Theme picker's own
	// pre-selection of the currently active theme.
	const focusedRow = picker.locator(
		".quick-input-list .monaco-list-row.focused",
	);
	await expect(focusedRow.locator(".label-name")).toHaveText("Minimal");

	// "None" is always the first row (see `noFileIconThemeItem`'s own doc
	// comment) — one ArrowUp from the pre-selected Minimal entry reaches it.
	await page.keyboard.press("ArrowUp");
	await expect(focusedRow).toContainText("None");
	await expect
		.poll(() => explorerRowIconBackgroundImage(page, "README.md"))
		.toBe("none");
	await page.keyboard.press("Enter");
	await expect(picker).toBeHidden();
	expect(await explorerRowIconBackgroundImage(page, "README.md")).toBe("none");
	expect((await workbenchThemeState(page)).classNames).not.toContain(
		"file-icons-enabled",
	);

	// Reopening and switching back to Minimal re-enables real icons.
	const secondPicker = await openFileIconThemePicker(page);
	const secondFocusedRow = secondPicker.locator(
		".quick-input-list .monaco-list-row.focused",
	);
	await expect(secondFocusedRow).toContainText("None");
	await page.keyboard.press("ArrowDown");
	await expect(secondFocusedRow.locator(".label-name")).toHaveText("Minimal");
	await page.keyboard.press("Enter");
	await expect(secondPicker).toBeHidden();
	await expect
		.poll(() => explorerRowIconBackgroundImage(page, "README.md"))
		.not.toBe("none");
	expect((await workbenchThemeState(page)).classNames).toContain(
		"file-icons-enabled",
	);

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

async function openProductIconThemePicker(page: Page): Promise<Locator> {
	await page.keyboard.press("ControlOrMeta+Shift+P");
	const picker = page.locator(".quick-input-widget");
	await expect(picker).toBeVisible();
	await picker.locator("input").pressSequentially("Product Icon Theme");
	const paletteCommand = picker.getByText("Preferences: Product Icon Theme", {
		exact: true,
	});
	await expect(paletteCommand).toHaveCount(1);
	await paletteCommand.click();
	await expect(picker.locator("input")).toHaveAttribute(
		"placeholder",
		"Select Product Icon Theme (Up/Down Keys to Preview)",
	);
	return picker;
}

test("lists only Default in the Product Icon Theme quick pick, and applying it leaves codicons rendering", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	// `theme-defaults` (the sole built-in extension) contributes no
	// `productIconThemes` at all (confirmed by reading its own build-time
	// manifest object — see `createPlainProductIconThemeRegistry`'s own doc
	// comment) — the picker offers exactly the always-available "Default"
	// entry, never zero rows.
	const picker = await openProductIconThemePicker(page);
	const pickerRows = picker.locator(".quick-input-list .monaco-list-row");
	await expect(pickerRows).toHaveCount(1);
	await expect(pickerRows.filter({ hasText: "Default" })).toHaveCount(1);
	const focusedRow = picker.locator(
		".quick-input-list .monaco-list-row.focused",
	);
	await expect(focusedRow).toContainText("Default");

	// The Explorer/Search/Settings activity bar tabs render entirely through
	// built-in codicons Plain never overrides — applying "Default" (a no-op:
	// it clears any custom `contributedProductIconTheme` rules, and there
	// were none to begin with) must never disturb their rendering.
	await page.keyboard.press("Enter");
	await expect(picker).toBeHidden();
	await expect(page.getByRole("tab", { name: /^Explorer / })).toBeVisible();
	await expect(page.getByRole("tab", { name: /^Search/ })).toBeVisible();
	expect(await page.locator(".contributedProductIconTheme").textContent()).toBe(
		"",
	);

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

// `F060` S3, part A: closes the S2 gap where an imported package's file
// icon/product icon themes were validated and stored by Rust (F060 S1) but
// never projected onto the wire (`ThemePackageSummary` lacked
// `iconThemes`/`productIconThemes`), so the frontend had no way to discover
// or apply them — see `docs/research/2026-07-24-icon-themes.md`'s "实施偏差
// 记录" and `src-tauri/src/theme/dto.rs`'s `IconThemeContributionSummary`.
test("discovers an imported package's file icon theme and product icon theme in their quick picks, and applying each is real", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	await installNativeIpcMock(page, "arrayBuffer", "readonly", {}, 20_000, 0, [
		IMPORTED_FANCY_ICONS_FIXTURE,
	]);
	await openNativeWorkspaceExplorer(page);

	const filePicker = await openFileIconThemePicker(page);
	const fancyFileIconRow = filePicker
		.locator(".quick-input-list .monaco-list-row")
		.filter({ hasText: "Fancy File Icons" });
	await expect(fancyFileIconRow).toHaveCount(1);
	await fancyFileIconRow.click();
	await expect(filePicker).toBeHidden();

	// Applied for real: `file-icons-enabled` stays set, and README.md's row
	// (the imported theme's own `iconDefinitions` only define the `file`
	// role, matched here) now resolves to a real, non-empty background
	// image — the theme's own SVG resource, not `vs-minimal`'s.
	expect((await workbenchThemeState(page)).classNames).toContain(
		"file-icons-enabled",
	);
	await expect
		.poll(() => explorerRowIconBackgroundImage(page, "README.md"))
		.not.toBe("none");
	expect(await explorerRowIconResourceText(page, "README.md")).toBe(
		IMPORTED_FANCY_ICONS_FIXTURE.resourceContents["fileicons/fancy-file.svg"],
	);

	// Reopening the picker and finding "Fancy File Icons" pre-selected
	// proves `getFileIconTheme()` now really returns this entry, not merely
	// that `setFileIconTheme` was called with it.
	const filePickerAfter = await openFileIconThemePicker(page);
	await expect(
		filePickerAfter.locator(".quick-input-list .monaco-list-row.focused"),
	).toContainText("Fancy File Icons");
	await page.keyboard.press("Escape");
	await expect(filePickerAfter).toBeHidden();

	const productPicker = await openProductIconThemePicker(page);
	const fancyProductIconRow = productPicker
		.locator(".quick-input-list .monaco-list-row")
		.filter({ hasText: "Fancy Product Icons" });
	await expect(fancyProductIconRow).toHaveCount(1);
	await fancyProductIconRow.click();
	await expect(productPicker).toBeHidden();

	// Applying it must never disturb the built-in codicons the Activity Bar
	// tabs render through (same zero-crash bar the built-in "Default" case
	// already holds itself to).
	await expect(page.getByRole("tab", { name: /^Explorer / })).toBeVisible();
	await expect(page.getByRole("tab", { name: /^Search/ })).toBeVisible();

	const productPickerAfter = await openProductIconThemePicker(page);
	await expect(
		productPickerAfter.locator(".quick-input-list .monaco-list-row.focused"),
	).toContainText("Fancy Product Icons");
	await page.keyboard.press("Escape");
	await expect(productPickerAfter).toBeHidden();

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

// `F060` S3, part B: preset selections on all three axes (one of them —
// the color theme — resolving against an imported package, closing the
// same S2 discovery gap from the selection-resolution side) must all take
// effect together at this session's own startup.
test("boots directly on persisted color, file icon and product icon theme selections from a previous session, including one from an imported package", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[IMPORTED_FANCY_ICONS_FIXTURE],
		[],
		"Fancy Icons Theme",
		"acme.fancy-file-icons",
		"acme.fancy-product-icons",
	);
	await openNativeWorkspaceExplorer(page);

	const state = await workbenchThemeState(page);
	expect(state.editorBackground).toBe("#654321");
	expect(state.classNames).not.toContain(DARK_MODERN.className);
	expect(state.classNames).toContain("file-icons-enabled");

	const filePicker = await openFileIconThemePicker(page);
	await expect(
		filePicker.locator(".quick-input-list .monaco-list-row.focused"),
	).toContainText("Fancy File Icons");
	await page.keyboard.press("Escape");
	await expect(filePicker).toBeHidden();

	const productPicker = await openProductIconThemePicker(page);
	await expect(
		productPicker.locator(".quick-input-list .monaco-list-row.focused"),
	).toContainText("Fancy Product Icons");
	await page.keyboard.press("Escape");
	await expect(productPicker).toBeHidden();

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("boots with icons disabled (the persisted None sentinel) and with Default (the persisted Default sentinel), never resurrecting the vs-minimal bootstrap default", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		"plain:no-file-icon-theme",
		"plain:default-product-icon-theme",
	);
	await openNativeWorkspaceExplorer(page);

	// Explicit "None" must actually disable icons on boot — not merely leave
	// the `vs-minimal` bootstrap default standing (which is exactly what a
	// bare `null` would do instead; see `NO_FILE_ICON_THEME_SELECTION_ID`'s
	// own doc comment).
	expect((await workbenchThemeState(page)).classNames).not.toContain(
		"file-icons-enabled",
	);
	expect(await explorerRowIconBackgroundImage(page, "README.md")).toBe("none");

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("persists the accepted file icon and product icon theme selections via theme_set_selection, including the None/Default sentinels", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	await installNativeIpcMock(page, "arrayBuffer");
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	expect(await fileIconThemeSetSelectionCalls(page)).toEqual([]);
	expect(await productIconThemeSetSelectionCalls(page)).toEqual([]);

	// File icon theme: switch to "None".
	const filePicker = await openFileIconThemePicker(page);
	await page.keyboard.press("ArrowUp");
	await expect(
		filePicker.locator(".quick-input-list .monaco-list-row.focused"),
	).toContainText("None");
	await page.keyboard.press("Enter");
	await expect(filePicker).toBeHidden();
	// `""` (upstream's own id for "None") is never sent on the wire — the
	// reserved sentinel is, so a restart can tell "explicitly disabled" apart
	// from "never touched this axis" (see this file's own boot test above).
	expect(await fileIconThemeSetSelectionCalls(page)).toEqual([
		"plain:no-file-icon-theme",
	]);
	// The color and product icon axes must never be touched by this call.
	expect(await themeSetSelectionCalls(page)).toEqual([]);
	expect(await productIconThemeSetSelectionCalls(page)).toEqual([]);

	// Product icon theme: re-confirm "Default" (the only entry) with Enter.
	const productPicker = await openProductIconThemePicker(page);
	await page.keyboard.press("Enter");
	await expect(productPicker).toBeHidden();
	expect(await productIconThemeSetSelectionCalls(page)).toEqual([
		"plain:default-product-icon-theme",
	]);
	expect(await fileIconThemeSetSelectionCalls(page)).toEqual([
		"plain:no-file-icon-theme",
	]);
	expect(await themeSetSelectionCalls(page)).toEqual([]);

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("falls back the file icon and product icon theme to their own defaults with zero crash when their persisted selection ids match nothing, independently of the color axis", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		"a-stale-file-icon-theme-id-from-a-removed-package",
		"a-stale-product-icon-theme-id-from-a-removed-package",
	);
	await openNativeWorkspaceExplorer(page);

	// Both stale ids fall back to whatever `applyDefault{FileIcon,ProductIcon}
	// Theme` already applied at bootstrap (`vs-minimal`/Default) — never a
	// crash, and never left standing to repeat the same fallback every boot.
	const state = await workbenchThemeState(page);
	expect(state.classNames).toContain("file-icons-enabled");
	expect(state.classNames).toContain(DARK_MODERN.className);
	await expect
		.poll(() => explorerRowIconBackgroundImage(page, "README.md"))
		.not.toBe("none");

	expect(await fileIconThemeSetSelectionCalls(page)).toEqual([null]);
	expect(await productIconThemeSetSelectionCalls(page)).toEqual([null]);
	// The color axis (never seeded with a stale id in this test) must stay
	// untouched.
	expect(await themeSetSelectionCalls(page)).toEqual([]);

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

// --- F070 "WebView DOM 渲染 + trust UX" -------------------------------------

async function terminalCallsFor(
	page: Page,
	command: string,
): Promise<readonly TestTauriInvocation[]> {
	return page.evaluate((command) => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
			(invocation) => invocation.command === command,
		);
	}, command);
}

async function pushTerminalOutput(
	page: Page,
	text: string,
	sessionId?: string,
): Promise<void> {
	await page.evaluate(
		({ text, sessionId }) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TERMINAL_PUSH__(text: string, sessionId?: string): void;
			};
			testWindow.__PLAIN_TEST_TERMINAL_PUSH__(text, sessionId);
		},
		{ text, sessionId },
	);
}

/** `F190` S6 "真实 exit banner": simulates the given session's shell process
 * exiting **on its own** (never an explicit `terminal_kill`) via
 * `__PLAIN_TEST_TERMINAL_EXIT__` — see that hook's own doc comment for why
 * the fake session is deliberately left in the mock's live table afterward,
 * mirroring the real `TerminalService`. */
async function emitTerminalProcessExit(
	page: Page,
	exitCode: number,
	signal: string | null = null,
	sessionId?: string,
): Promise<void> {
	await page.evaluate(
		({ exitCode, signal, sessionId }) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TERMINAL_EXIT__(
					exitCode: number,
					signal?: string | null,
					sessionId?: string,
				): void;
			};
			testWindow.__PLAIN_TEST_TERMINAL_EXIT__(exitCode, signal, sessionId);
		},
		{ exitCode, signal, sessionId },
	);
}

/** Pushes every one of `lines` (each newline-terminated) via its own
 * `__PLAIN_TEST_TERMINAL_PUSH__` call, all within a single synchronous
 * `page.evaluate` turn -- the same "many writes with no yield in between"
 * shape a real pty reader flooding output at OS speed produces, without
 * Playwright's own per-call round-trip overhead making a large burst
 * impractically slow to simulate (see the high-throughput backpressure test
 * below). */
async function pushTerminalOutputBurst(
	page: Page,
	lines: readonly string[],
	sessionId?: string,
): Promise<void> {
	await page.evaluate(
		({ lines, sessionId }) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TERMINAL_PUSH__(text: string, sessionId?: string): void;
			};
			for (const line of lines) {
				testWindow.__PLAIN_TEST_TERMINAL_PUSH__(`${line}\n`, sessionId);
			}
		},
		{ lines, sessionId },
	);
}

/** `F190` S4 "Ghostty metadata and links": mirrors
 * `__PLAIN_TEST_TERMINAL_SET_METADATA__`'s own patch shape (see
 * `installNativeIpcMock`'s definition of that hook). */
interface TestTerminalMetadataPatch {
	pwd?: string | null;
	hyperlink?: {
		row: number;
		colStart: number;
		colEnd: number;
		uri: string | null;
	};
	semantic?: {
		row: number;
		colStart: number;
		colEnd: number;
		kind: "output" | "input" | "prompt";
	};
	rowSemanticPrompt?: {
		row: number;
		kind: "none" | "prompt" | "continuation";
	};
}

/** `F190` S4 "Ghostty metadata and links": scripts one session's OSC
 * 7 pwd / OSC 8 hyperlink / OSC 133 semantic / OSC 133 row-semantic-prompt
 * metadata via `__PLAIN_TEST_TERMINAL_SET_METADATA__` and waits for the
 * resulting frame to actually paint. */
async function setTerminalMetadata(
	page: Page,
	patch: TestTerminalMetadataPatch,
	sessionId?: string,
): Promise<void> {
	await page.evaluate(
		({ patch, sessionId }) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TERMINAL_SET_METADATA__(
					patch: TestTerminalMetadataPatch,
					sessionId?: string,
				): void;
			};
			testWindow.__PLAIN_TEST_TERMINAL_SET_METADATA__(patch, sessionId);
		},
		{ patch, sessionId },
	);
}

/** Every currently-live fake session id, in the order `terminal_start`
 * created them — lets a multi-tab/split test target a specific tab/pane's
 * session without guessing at IPC-call ordering. */
async function terminalSessionIds(page: Page): Promise<readonly string[]> {
	return page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TERMINAL_SESSION_IDS__(): readonly string[];
		};
		return testWindow.__PLAIN_TEST_TERMINAL_SESSION_IDS__();
	});
}

async function createTerminal(page: Page): Promise<void> {
	await executePaletteCommand(
		page,
		"Create Terminal",
		"Plain: Create Terminal",
	);
}

test("opens a trusted terminal, renders a pushed frame, and echoes typed input", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);

	const surface = page.locator(".plain-terminal-surface");
	await expect(surface).toBeVisible();
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(1);
	const [startCall] = await terminalCallsFor(page, "terminal_start");
	expect(startCall?.args.request).toMatchObject({
		rootId: nativeRootId,
		profileId: "systemDefault",
		cwd: null,
	});

	await pushTerminalOutput(page, "hello");
	await expect(page.locator(".plain-terminal-grid")).toContainText("hello");

	const input = page.locator(".plain-terminal-input");
	await input.focus();
	await page.keyboard.type("abc");

	await expect
		.poll(
			async () =>
				(await terminalCallsFor(page, "terminal_input_key")).filter(
					({ args }) =>
						typeof args.request === "object" &&
						args.request !== null &&
						typeof (args.request as { utf8?: unknown }).utf8 === "string",
				).length,
		)
		.toBeGreaterThanOrEqual(3);
	await expect(page.locator(".plain-terminal-grid")).toContainText("helloabc");

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("resizes the terminal grid to match the panel's real size", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);
	await expect(page.locator(".plain-terminal-surface")).toBeVisible();

	const startCalls = await terminalCallsFor(page, "terminal_start");
	expect(startCalls).toHaveLength(1);
	const initialRequest = startCalls[0]?.args.request as
		{ cols?: number; rows?: number } | undefined;
	const initialCols = initialRequest?.cols;
	expect(typeof initialCols).toBe("number");

	const viewport = page.viewportSize();
	await page.setViewportSize({
		width: (viewport?.width ?? 1280) + 480,
		height: viewport?.height ?? 720,
	});

	await expect
		.poll(async () => {
			const resizeCalls = await terminalCallsFor(page, "terminal_resize");
			return resizeCalls.some(({ args }) => {
				const request = args.request as
					{ cols?: number; rows?: number } | undefined;
				return (
					typeof request?.cols === "number" &&
					typeof request.rows === "number" &&
					request.cols > 0 &&
					request.rows > 0 &&
					request.cols !== initialCols
				);
			});
		})
		.toBe(true);

	expect(pageErrors).toEqual([]);
});

test("prompts for workspace trust before starting a terminal and starts it once granted", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(page, "arrayBuffer", "readonly");
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);

	const confirmDialog = page.getByRole("dialog");
	await expect(confirmDialog).toBeVisible();
	await expect(confirmDialog).toContainText(
		"Trust this workspace to run a terminal?",
	);
	expect(await terminalCallsFor(page, "terminal_start")).toEqual([]);

	await confirmDialog
		.getByRole("button", { name: "Trust & Continue", exact: true })
		.click();
	await expect(confirmDialog).toHaveCount(0);

	await expect
		.poll(
			async () =>
				(await terminalCallsFor(page, "workspace_trust_grant")).length,
		)
		.toBe(1);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(1);
	await expect(page.locator(".plain-terminal-surface")).toBeVisible();

	expect(pageErrors).toEqual([]);
});

test("leaves the terminal disabled with an explanation when the trust dialog is declined", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(page, "arrayBuffer", "readonly");
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);

	const confirmDialog = page.getByRole("dialog");
	await expect(confirmDialog).toBeVisible();
	await confirmDialog
		.getByRole("button", { name: "Cancel", exact: true })
		.click();
	await expect(confirmDialog).toHaveCount(0);

	await expect(page.locator(".plain-terminal-status")).toHaveText(
		"Terminal is disabled until you trust this workspace.",
	);
	expect(await terminalCallsFor(page, "workspace_trust_grant")).toEqual([]);
	expect(await terminalCallsFor(page, "terminal_start")).toEqual([]);

	expect(pageErrors).toEqual([]);
});

test("explains that a folder must be open first, for an empty workspace, and never starts a terminal", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(page, "arrayBuffer", "readonly");
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);
	await createTerminal(page);

	const infoDialog = page.getByRole("dialog");
	await expect(infoDialog).toBeVisible();
	await expect(infoDialog).toContainText(
		"Plain needs an open folder before it can start a terminal.",
	);
	await infoDialog.getByRole("button", { name: "OK", exact: true }).click();
	await expect(infoDialog).toHaveCount(0);

	await expect(page.locator(".plain-terminal-empty-state")).toHaveText(
		"Open a folder to use the terminal.",
	);
	expect(await terminalCallsFor(page, "workspace_trust_state")).toEqual([]);
	expect(await terminalCallsFor(page, "terminal_start")).toEqual([]);

	expect(pageErrors).toEqual([]);
});

test("sends only the final IME-committed text, never intermediate composition state", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);
	await expect(page.locator(".plain-terminal-surface")).toBeVisible();

	const input = page.locator(".plain-terminal-input");
	await input.focus();
	// `Locator.dispatchEvent` does not construct a real `CompositionEvent`
	// for these event names (its own generic event-type map does not cover
	// composition events), so `.data` would not survive the round trip —
	// dispatch genuine `CompositionEvent`s directly in-page instead.
	await input.evaluate((element) => {
		const fire = (type: string, data: string): void => {
			element.dispatchEvent(new CompositionEvent(type, { data }));
		};
		fire("compositionstart", "");
		fire("compositionupdate", "n");
		fire("compositionupdate", "ni");
		fire("compositionupdate", "nih");
		fire("compositionend", "你好");
	});

	await expect
		.poll(
			async () => (await terminalCallsFor(page, "terminal_input_text")).length,
		)
		.toBe(1);
	const textCalls = await terminalCallsFor(page, "terminal_input_text");
	expect(
		(textCalls[0]?.args.request as { text?: string } | undefined)?.text,
	).toBe("你好");
	await expect(page.locator(".plain-terminal-grid")).toContainText("你好");

	// No intermediate composition text ever reached `terminal_input_key`
	// either — it is gated on `TerminalImeController.active`, not just
	// `terminal_input_text`.
	const keyCallsWithText = (
		await terminalCallsFor(page, "terminal_input_key")
	).filter(
		({ args }) =>
			typeof args.request === "object" &&
			args.request !== null &&
			typeof (args.request as { utf8?: unknown }).utf8 === "string",
	);
	expect(keyCallsWithText).toEqual([]);

	expect(pageErrors).toEqual([]);
});

// --- F070 "多 tab/split/scrollback + 生命周期" -------------------------------

// Search evaluation (acceptance #1's "search" — see the F070 "多 tab/split/
// scrollback" report for the full evaluation and why a custom find widget
// is *not* built this slice): DOM rendering already puts real, selectable
// text nodes on screen — this proves the "at least visible text can be
// selected" half of the acceptance bar concretely, via the same
// `Selection`/`Range` API a real find-in-page implementation (browser-native
// or self-built) would eventually use to highlight/extract a match, rather
// than merely asserting by inspection that the DOM contains text nodes.
test("terminal output is real, selectable DOM text (native Selection/Range over the grid)", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);
	await expect(page.locator(".plain-terminal-surface")).toBeVisible();

	await pushTerminalOutput(page, "selectable-terminal-text");
	await expect(page.locator(".plain-terminal-grid")).toContainText(
		"selectable-terminal-text",
	);

	const selectedText = await page
		.locator(".plain-terminal-grid")
		.evaluate((grid) => {
			const selection = grid.ownerDocument.getSelection();
			if (selection === null) {
				return "";
			}
			const range = grid.ownerDocument.createRange();
			range.selectNodeContents(grid);
			selection.removeAllRanges();
			selection.addRange(range);
			return selection.toString();
		});
	expect(selectedText).toContain("selectable-terminal-text");

	expect(pageErrors).toEqual([]);
});

// F070 "压测与收口": a real interactive shell session can flood far more
// output in one burst than the single-frame-in-flight emission credit
// (`FrameEmitGate`, `src-tauri/src/terminal/service.rs`'s vt thread) or this
// fixture's own mirrored `awaitingAck`/`pendingEmit` gate is designed to
// forward as individual frames -- this is exactly the scenario the gate
// exists to absorb. This test proves the coalescing behavior end to end
// through the real frontend transport/renderer (not just the Rust-side gate
// unit tests in `src-tauri/src/terminal/service/tests.rs`): the burst's
// final content still arrives (nothing silently dropped), the number of
// real frame/ack round trips stays small regardless of how many lines were
// pushed (proving frames were genuinely coalesced, not merely fast), and the
// page keeps accepting keyboard input immediately afterward (proving the
// render loop was never stalled waiting on the flood).
test("a high-throughput burst of output is coalesced by the single-frame credit gate instead of stalling the UI or dropping content", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);
	await expect(page.locator(".plain-terminal-surface")).toBeVisible();

	// Far more lines than any real interactive shell would produce between
	// two animation frames, pushed with no yield in between (see
	// `pushTerminalOutputBurst`'s own doc comment).
	const lineCount = 500;
	const lines = Array.from(
		{ length: lineCount },
		(_unused, index) => `burst-${String(index).padStart(4, "0")}`,
	);
	await pushTerminalOutputBurst(page, lines);

	const grid = page.locator(".plain-terminal-grid");
	// The last pushed line must eventually be visible -- proving the burst's
	// content reached the screen, only coalesced rather than dropped -- and
	// must do so quickly (well inside a tight timeout), proving the render
	// loop was not blocked waiting on anything.
	await expect(grid).toContainText(
		`burst-${String(lineCount - 1).padStart(4, "0")}`,
		{ timeout: 3_000 },
	);

	// The real evidence the credit gate did its job rather than merely "not
	// crashing": one frame/ack round trip per pushed line would mean
	// hundreds of them; the gate coalesces the entire burst (fed
	// synchronously, with no chance for a paint+ack to interleave mid-burst)
	// into a small, bounded number regardless of how many lines were pushed.
	const ackCalls = await terminalCallsFor(page, "terminal_ack");
	expect(ackCalls.length).toBeGreaterThan(0);
	expect(ackCalls.length).toBeLessThan(10);

	// The page must have stayed responsive: typing into the terminal's own
	// input right after the burst must still work normally rather than
	// queueing up behind a stalled render loop.
	const input = page.locator(".plain-terminal-input").first();
	await input.focus();
	await page.keyboard.type("still-responsive");
	await expect(grid).toContainText("still-responsive");

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

function terminalKillSessionIds(
	calls: readonly TestTauriInvocation[],
): readonly (string | undefined)[] {
	return calls.map(
		({ args }) =>
			(args.request as { sessionId?: string } | undefined)?.sessionId,
	);
}

test("opens two terminal tabs with independent sessions, switches between them, and keeps the other alive when the active one is closed", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);

	await createTerminal(page);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(1);
	await createTerminal(page);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(2);

	const [firstSessionId, secondSessionId] = await terminalSessionIds(page);
	expect(firstSessionId).not.toBe(undefined);
	expect(secondSessionId).not.toBe(undefined);
	expect(firstSessionId).not.toBe(secondSessionId);

	const tab1 = page.locator(".plain-terminal-tab", { hasText: "Terminal 1" });
	const tab2 = page.locator(".plain-terminal-tab", { hasText: "Terminal 2" });
	// Creating a second tab activates it, leaving the first running but not
	// visible.
	await expect(tab2).toHaveAttribute("data-active", "true");
	await expect(tab1).toHaveAttribute("data-active", "false");

	await pushTerminalOutput(page, "from-tab-one", firstSessionId);
	await pushTerminalOutput(page, "from-tab-two", secondSessionId);

	const activePane = page.locator(
		'.plain-terminal-panecontainer[data-active="true"]',
	);
	await expect(activePane).toContainText("from-tab-two");
	await expect(activePane).not.toContainText("from-tab-one");

	await tab1.click();
	await expect(tab1).toHaveAttribute("data-active", "true");
	await expect(tab2).toHaveAttribute("data-active", "false");
	await expect(activePane).toContainText("from-tab-one");
	await expect(activePane).not.toContainText("from-tab-two");

	// Closing the active tab (via its own close button) kills exactly its
	// session — the other tab's session is never touched.
	await tab1.locator(".plain-terminal-tab-close").click();
	await expect(tab1).toHaveCount(0);
	await expect
		.poll(async () =>
			terminalKillSessionIds(await terminalCallsFor(page, "terminal_kill")),
		)
		.toEqual([firstSessionId]);
	await expect(tab2).toHaveAttribute("data-active", "true");
	await expect(activePane).toContainText("from-tab-two");

	// The survivor keeps working after the other's session is gone.
	await pushTerminalOutput(page, "-still-alive", secondSessionId);
	await expect(activePane).toContainText("from-tab-two-still-alive");

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("Plain: Kill Terminal closes the active tab's session, leaving other tabs untouched", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);

	await createTerminal(page);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(1);
	await createTerminal(page);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(2);
	const [, activeSessionId] = await terminalSessionIds(page);

	const tab1 = page.locator(".plain-terminal-tab", { hasText: "Terminal 1" });
	const tab2 = page.locator(".plain-terminal-tab", { hasText: "Terminal 2" });
	await expect(tab2).toHaveAttribute("data-active", "true");

	await executePaletteCommand(page, "Kill Terminal", "Plain: Kill Terminal");

	await expect(tab2).toHaveCount(0);
	await expect(tab1).toHaveAttribute("data-active", "true");
	await expect
		.poll(async () =>
			terminalKillSessionIds(await terminalCallsFor(page, "terminal_kill")),
		)
		.toEqual([activeSessionId]);

	expect(pageErrors).toEqual([]);
});

test("splits a terminal tab into two independently sized panes, each with its own session", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(1);

	await executePaletteCommand(
		page,
		"Split Terminal Right",
		"Plain: Split Terminal Right",
	);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(2);

	const [firstSessionId, secondSessionId] = await terminalSessionIds(page);
	expect(firstSessionId).not.toBe(secondSessionId);

	const activePane = page.locator(
		'.plain-terminal-panecontainer[data-active="true"]',
	);
	const panes = activePane.locator(".plain-terminal-pane");
	await expect(panes).toHaveCount(2);
	const firstPane = panes.nth(0);
	const secondPane = panes.nth(1);
	await expect(firstPane).toBeVisible();
	await expect(secondPane).toBeVisible();

	// Genuinely split side by side — neither pane spans the whole container.
	const containerBox = await activePane.boundingBox();
	const firstBox = await firstPane.boundingBox();
	expect(containerBox).not.toBeNull();
	expect(firstBox).not.toBeNull();
	if (containerBox !== null && firstBox !== null) {
		expect(firstBox.width).toBeLessThan(containerBox.width * 0.7);
	}

	await pushTerminalOutput(page, "left-pane-text", firstSessionId);
	await pushTerminalOutput(page, "right-pane-text", secondSessionId);
	await expect(firstPane.locator(".plain-terminal-grid")).toContainText(
		"left-pane-text",
	);
	await expect(firstPane.locator(".plain-terminal-grid")).not.toContainText(
		"right-pane-text",
	);
	await expect(secondPane.locator(".plain-terminal-grid")).toContainText(
		"right-pane-text",
	);
	await expect(secondPane.locator(".plain-terminal-grid")).not.toContainText(
		"left-pane-text",
	);

	// Each pane resized independently to its own real (halved) width — both
	// requested cols are positive and distinct from a naive full-width guess.
	const startCalls = await terminalCallsFor(page, "terminal_start");
	for (const call of startCalls) {
		const request = call.args.request as
			{ cols?: number; rows?: number } | undefined;
		expect(request?.cols ?? 0).toBeGreaterThan(0);
		expect(request?.rows ?? 0).toBeGreaterThan(0);
	}

	expect(pageErrors).toEqual([]);
});

test("renders fetched scrollback history when scrolling up, and resumes following live output at the bottom", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);
	await expect(page.locator(".plain-terminal-surface")).toBeVisible();

	// Push far more lines than any plausible viewport row count, so plenty
	// scroll off into the fake PTY's `scrollback` array (see the mock's
	// `terminalScrollUpOneLine`).
	const lineCount = 200;
	const lines = Array.from(
		{ length: lineCount },
		(_unused, index) => `hist-${String(index).padStart(4, "0")}`,
	);
	await pushTerminalOutput(page, `${lines.join("\n")}\n`);

	const grid = page.locator(".plain-terminal-grid");
	await expect(grid).toContainText(
		`hist-${String(lineCount - 1).padStart(4, "0")}`,
	);
	await expect(grid).not.toContainText("hist-0000");

	expect(await terminalCallsFor(page, "terminal_scrollback")).toEqual([]);

	// Scroll up: dispatched as a burst of synchronous wheel ticks (the
	// pane's own de-duplicated in-flight fetch — see
	// `TerminalPaneController.#ensureScrollbackCache` — is what keeps this a
	// single `terminal_scrollback` round trip despite the burst).
	await page
		.locator(".plain-terminal-surface-wrapper")
		.first()
		.evaluate((element) => {
			for (let tick = 0; tick < 80; tick += 1) {
				element.dispatchEvent(
					new WheelEvent("wheel", {
						deltaY: -300,
						bubbles: true,
						cancelable: true,
					}),
				);
			}
		});

	await expect(grid).toContainText("hist-0000");
	await expect
		.poll(
			async () => (await terminalCallsFor(page, "terminal_scrollback")).length,
		)
		.toBe(1);

	// Back to the bottom: press Shift+End on the terminal's own focused
	// input, then confirm live output resumes.
	const input = page.locator(".plain-terminal-input").first();
	await input.focus();
	await input.press("Shift+End");
	await expect(grid).toContainText(
		`hist-${String(lineCount - 1).padStart(4, "0")}`,
	);
	await expect(grid).not.toContainText("hist-0000");

	await pushTerminalOutput(page, "back-to-live");
	await expect(grid).toContainText("back-to-live");

	expect(pageErrors).toEqual([]);
});

// `F190` S5 "find and live scrollback" — bounded terminal-buffer find widget
// and live-updating (anchor-preserving) scrollback history. See
// `docs/research/2026-08-03-complete-terminal.md`'s "架构裁定 §2/§5" and
// `plain-terminal-find.ts`/`plain-terminal-live-refresh.ts`/
// `plain-terminal-pane.ts`'s own module docs for the full design.

test("Ctrl+F opens the find widget, searches across scrollback and the live viewport, and prev/next navigation (buttons and Enter/Shift+Enter) highlights and reveals the right match", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);
	await expect(page.locator(".plain-terminal-surface")).toBeVisible();

	// 80 short, uniquely-numbered lines — far more than any plausible
	// viewport row count (see the scrollback test above's own precedent), so
	// most of them scroll off into retained scrollback while the last few
	// stay on the live viewport. Two of them additionally carry a second,
	// rarer marker: one deep in scrollback, one still on the live viewport —
	// exercising "查询集合 = 最多 10,000 行 retained scrollback + 当前
	// viewport" in a single query.
	const lineCount = 80;
	const lines = Array.from({ length: lineCount }, (_unused, index) => {
		if (index === 5) return "findmark-005 raremarker-a";
		if (index === 75) return "findmark-075 raremarker-b";
		return `findmark-${String(index).padStart(3, "0")}`;
	});
	await pushTerminalOutputBurst(page, lines);

	const grid = page.locator(".plain-terminal-grid");
	await expect(grid).toContainText("findmark-079");
	await expect(grid).not.toContainText("findmark-005");

	const input = page.locator(".plain-terminal-input").first();
	await input.press("Control+f");

	const findWidget = page.locator(".plain-terminal-find");
	await expect(findWidget).toBeVisible();
	const findInput = page.locator(".plain-terminal-find-input");
	await expect(findInput).toBeFocused();
	const count = page.locator(".plain-terminal-find-count");
	const activeHighlight = page.locator(
		".plain-terminal-find-highlight--active",
	);

	await findInput.fill("findmark");
	await expect(count).toHaveText("1/80");
	// The very first match ("findmark-005", deep in scrollback) must have
	// scrolled the pane's view to actually reveal it, and be highlighted.
	await expect(grid).toContainText("findmark-005");
	await expect(activeHighlight).toHaveCount(1);

	// Next via the button, then via Enter, then back via Shift+Enter.
	await page.getByRole("button", { name: "Next Match" }).click();
	await expect(count).toHaveText("2/80");
	await findInput.press("Enter");
	await expect(count).toHaveText("3/80");
	await findInput.press("Shift+Enter");
	await expect(count).toHaveText("2/80");

	// Jumping straight to the very last match reveals the still-live tail.
	await findInput.fill("findmark-079");
	await expect(count).toHaveText("1/1");
	await expect(grid).toContainText("findmark-079");
	await expect(activeHighlight).toHaveCount(1);

	// A two-match query spanning scrollback and the live viewport, including
	// wraparound via the Next button.
	await findInput.fill("raremarker");
	await expect(count).toHaveText("1/2");
	await expect(grid).toContainText("raremarker-a"); // deep scrollback match
	await page.getByRole("button", { name: "Next Match" }).click();
	await expect(count).toHaveText("2/2");
	await expect(grid).toContainText("raremarker-b"); // still-live tail match
	await page.getByRole("button", { name: "Next Match" }).click();
	await expect(count).toHaveText("1/2"); // wraps back to the first match
	await expect(grid).toContainText("raremarker-a");

	expect(pageErrors).toEqual([]);
});

test("case-sensitivity toggle changes the terminal find match set", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);
	await expect(page.locator(".plain-terminal-surface")).toBeVisible();

	await pushTerminalOutput(page, "Error error ERROR case-test\n");
	const grid = page.locator(".plain-terminal-grid");
	await expect(grid).toContainText("case-test");

	const input = page.locator(".plain-terminal-input").first();
	await input.press("Control+f");
	const findInput = page.locator(".plain-terminal-find-input");
	await expect(findInput).toBeFocused();
	const count = page.locator(".plain-terminal-find-count");

	// Case-insensitive by default: all three spellings match.
	await findInput.fill("error");
	await expect(count).toHaveText("1/3");

	const caseButton = page.getByRole("button", { name: "Match Case" });
	await expect(caseButton).toHaveAttribute("aria-pressed", "false");
	await caseButton.click();
	await expect(caseButton).toHaveAttribute("aria-pressed", "true");
	// Case-sensitive: only the lowercase "error" matches.
	await expect(count).toHaveText("1/1");

	await caseButton.click();
	await expect(caseButton).toHaveAttribute("aria-pressed", "false");
	await expect(count).toHaveText("1/3");

	expect(pageErrors).toEqual([]);
});

test("live scrollback keeps refreshing and preserves its anchor while parked in history, without forcing a jump to live", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);
	await expect(page.locator(".plain-terminal-surface")).toBeVisible();

	const seedCount = 150;
	const seedLines = Array.from(
		{ length: seedCount },
		(_unused, index) => `seed-${String(index).padStart(3, "0")}`,
	);
	await pushTerminalOutputBurst(page, seedLines);

	const grid = page.locator(".plain-terminal-grid");
	await expect(grid).toContainText(
		`seed-${String(seedCount - 1).padStart(3, "0")}`,
	);

	// The real, measured viewport row count — pushing more new lines than
	// this would start evicting the *newly*-pushed lines themselves (not
	// just older `seed-*` ones) into scrollback once they no longer fit the
	// live viewport either, which would break this test's exact-shift math
	// below. Growing by at most half of it keeps every evicted row a
	// `seed-*` one, regardless of how large or small the real panel is.
	const rowCount = await page.locator(".plain-terminal-row").count();
	expect(rowCount).toBeGreaterThan(0);
	const growCount = Math.max(2, Math.floor(rowCount / 2));

	// A small, deliberately-unclamped scroll-up (well short of the oldest
	// retained row) — the discovery fetch below is this pane's first, and
	// only, up-front `terminal_scrollback` call.
	const surface = page.locator(".plain-terminal-surface-wrapper").first();
	await surface.evaluate((element) => {
		for (let tick = 0; tick < 5; tick += 1) {
			element.dispatchEvent(
				new WheelEvent("wheel", {
					deltaY: -300,
					bubbles: true,
					cancelable: true,
				}),
			);
		}
	});
	await expect
		.poll(
			async () => (await terminalCallsFor(page, "terminal_scrollback")).length,
		)
		.toBe(1);
	// The call-count poll above only proves the IPC round trip happened, not
	// that the resulting repaint has already landed in the DOM — wait for
	// that too (the same synchronous paint that updates `topRow` below) so
	// the one-shot `textContent()` read after it is not a race.
	await expect(grid).not.toContainText(
		`seed-${String(seedCount - 1).padStart(3, "0")}`,
	);

	const topRow = page.locator(".plain-terminal-row").first();
	const beforeText = (await topRow.textContent()) ?? "";
	const beforeMatch = /seed-(\d+)/.exec(beforeText);
	expect(beforeMatch).not.toBeNull();
	const beforeIndex = Number(beforeMatch![1]);

	// New output arrives while still parked in history: this must not crash,
	// must not silently do nothing (the pre-`F190`-S5 frozen-snapshot bug),
	// and must not force a jump back to live.
	const growLines = Array.from(
		{ length: growCount },
		(_unused, index) => `grown-${String(index).padStart(3, "0")}`,
	);
	await pushTerminalOutputBurst(page, growLines);

	// Merge-refresh actually ran (more than the one up-front discovery
	// fetch) — but bounded, never one fetch per pushed line (`growCount`
	// pushes must not each produce their own scrollback call; "fetch 期间
	// 到达的更多 frame 合并成一次后续 refresh").
	await expect
		.poll(
			async () => (await terminalCallsFor(page, "terminal_scrollback")).length,
			{ timeout: 10_000 },
		)
		.toBeGreaterThanOrEqual(2);
	const finalScrollbackCalls = (
		await terminalCallsFor(page, "terminal_scrollback")
	).length;
	expect(finalScrollbackCalls).toBeLessThanOrEqual(4);

	// Anchor preserved: pinned the same number of rows back from the live
	// tip, so as exactly `growCount` new rows joined the tip, the window's
	// topmost row advances by exactly `growCount` — not staying frozen
	// (the old bug) and not jumping to the new live tail either.
	const expectedIndex = beforeIndex + growCount;
	await expect(topRow).toContainText(
		`seed-${String(expectedIndex).padStart(3, "0")}`,
		{ timeout: 10_000 },
	);
	await expect(grid).not.toContainText(
		`grown-${String(growCount - 1).padStart(3, "0")}`,
	);

	expect(pageErrors).toEqual([]);
});

test("typing into the terminal while parked in history or with find open returns to live and closes the find widget", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);
	await expect(page.locator(".plain-terminal-surface")).toBeVisible();

	const lineCount = 80;
	const lines = Array.from(
		{ length: lineCount },
		(_unused, index) => `hist-${String(index).padStart(3, "0")}`,
	);
	await pushTerminalOutputBurst(page, lines);

	const grid = page.locator(".plain-terminal-grid");
	await expect(grid).toContainText(
		`hist-${String(lineCount - 1).padStart(3, "0")}`,
	);

	// Scroll far away from live (well clear of the tail) and open find.
	const surface = page.locator(".plain-terminal-surface-wrapper").first();
	await surface.evaluate((element) => {
		for (let tick = 0; tick < 80; tick += 1) {
			element.dispatchEvent(
				new WheelEvent("wheel", {
					deltaY: -300,
					bubbles: true,
					cancelable: true,
				}),
			);
		}
	});
	await expect(grid).toContainText("hist-000");
	await expect(grid).not.toContainText(
		`hist-${String(lineCount - 1).padStart(3, "0")}`,
	);

	const input = page.locator(".plain-terminal-input").first();
	await input.press("Control+f");
	const findWidget = page.locator(".plain-terminal-find");
	await expect(findWidget).toBeVisible();
	await page.locator(".plain-terminal-find-input").fill("hist");
	await expect(page.locator(".plain-terminal-find-count")).toHaveText(
		`1/${lineCount}`,
	);

	// Focus moves back onto the terminal's own input (not the find widget's
	// query box) and a real character is typed — this is genuine terminal
	// input, distinct from typing into the find query box (which would only
	// edit the search query, never reach the pty). A direct `.focus()`
	// (rather than a real trusted mouse click on the pane, which triggers
	// the browser's own native "blur the previously-focused element on a
	// non-focusable click target" default action *after* this class's own
	// `mousedown` handler already ran, undoing it) isolates this test to the
	// one behavior `F190` S5 actually changed — "typing returns to live and
	// closes find" — from that separate, pre-existing, out-of-scope
	// click-focus interaction.
	await input.focus();
	await input.press("x");

	await expect(findWidget).toBeHidden();
	// Returned to live: the tail content (invisible while parked in
	// history above) is visible again.
	await expect(grid).toContainText(
		`hist-${String(lineCount - 1).padStart(3, "0")}`,
	);
	expect(
		(await terminalCallsFor(page, "terminal_input_key")).length,
	).toBeGreaterThan(0);

	expect(pageErrors).toEqual([]);
});

test("find widget shows accurate status when the match count or query length hit their hard caps", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);
	await expect(page.locator(".plain-terminal-surface")).toBeVisible();

	// Well over `TERMINAL_FIND_MAX_MATCHES` (5,000) occurrences of a single
	// character, regardless of the pane's real measured column count: 60
	// pushed "lines" of 200 `q`s each line-wrap into however many physical
	// rows the pane actually has, but always total 12,000 `q` characters.
	const qLine = "q".repeat(200);
	const lines = Array.from({ length: 60 }, () => qLine);
	await pushTerminalOutputBurst(page, lines);

	const input = page.locator(".plain-terminal-input").first();
	await input.press("Control+f");
	const findInput = page.locator(".plain-terminal-find-input");
	await expect(findInput).toBeFocused();
	const count = page.locator(".plain-terminal-find-count");

	await findInput.fill("q");
	await expect(count).toHaveText("1/5000+ (limit reached)");

	// Independently, a query longer than the hard cap is truncated (not
	// rejected outright) and reported via the hint text — never silently
	// behaving as if the extra characters were simply never typed.
	await findInput.fill("z".repeat(300));
	await expect(page.locator(".plain-terminal-find-hint")).toHaveText(
		"Query truncated to 256 characters (limit reached).",
	);

	expect(pageErrors).toEqual([]);
});

test("reloading the page while multiple terminal tabs (including a split) are open tears down cleanly with no pageerror", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);

	await createTerminal(page);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(1);
	await executePaletteCommand(
		page,
		"Split Terminal Down",
		"Plain: Split Terminal Down",
	);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(2);
	await createTerminal(page);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(3);
	await expect(page.locator(".plain-terminal-tab")).toHaveCount(2);

	await page.reload();
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	expect(pageErrors).toEqual([]);
});

test("Terminal requires an explicit root in a multi-root workspace and freezes it per tab and split", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});

	await installMultiRootNativeIpcMock(page);
	await openNativeWorkspaceExplorer(page);
	await executePaletteCommand(
		page,
		"Add Folder to Workspace",
		"Workspaces: Add Folder to Workspace...",
	);

	await createTerminal(page);
	const selector = page.getByRole("combobox", {
		name: "New Terminal Working Folder",
	});
	await expect(selector).toBeEnabled();
	await expect(selector).toHaveValue("");
	await expect(page.locator(".plain-terminal-empty-state")).toHaveText(
		"Select a working folder to create a terminal.",
	);
	expect(await terminalCallsFor(page, "terminal_start")).toEqual([]);

	await selector.selectOption(nativeSecondaryRootId);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(1);
	await expect(
		page.locator(".plain-terminal-tab", {
			hasText: "Terminal 1 · plain-library",
		}),
	).toHaveCount(1);
	let starts = await terminalCallsFor(page, "terminal_start");
	expect(starts[0]?.args.request).toMatchObject({
		rootId: nativeSecondaryRootId,
		profileId: "systemDefault",
		cwd: null,
	});

	// Changing the selector only chooses the root for future tabs. A split
	// remains bound to the active tab's immutable secondary-root identity.
	await selector.selectOption(nativeRootId);
	await page.getByRole("button", { name: "Split Terminal Right" }).click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(2);
	starts = await terminalCallsFor(page, "terminal_start");
	expect(starts[1]?.args.request).toMatchObject({
		rootId: nativeSecondaryRootId,
		profileId: "systemDefault",
		cwd: null,
	});

	await page.getByRole("button", { name: "New Terminal" }).click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(3);
	starts = await terminalCallsFor(page, "terminal_start");
	expect(starts[2]?.args.request).toMatchObject({
		rootId: nativeRootId,
		profileId: "systemDefault",
		cwd: null,
	});
	await expect(
		page.locator(".plain-terminal-tab", {
			hasText: "Terminal 2 · plain-workspace",
		}),
	).toHaveCount(1);

	expect(errors).toEqual([]);
});

// --- F190 S3: "recursive split tree" (active pane, 8-pane cap) ----------

test("recursively splits a tab to 3 panes, building a two-level split tree with correct row/column directions", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(1);

	await page.getByRole("button", { name: "Split Terminal Right" }).click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(2);
	// The just-created second pane is now active — splitting again must
	// target it (a second, nested level), not the tab's original pane.
	await page.getByRole("button", { name: "Split Terminal Down" }).click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(3);

	const activePane = page.locator(
		'.plain-terminal-panecontainer[data-active="true"]',
	);
	const panes = activePane.locator(".plain-terminal-pane");
	await expect(panes).toHaveCount(3);
	const splits = activePane.locator(".plain-terminal-split");
	await expect(splits).toHaveCount(2);
	// Document order is pre-order — the outer split precedes the nested one.
	await expect(splits.nth(0)).toHaveAttribute("data-split", "row");
	await expect(splits.nth(1)).toHaveAttribute("data-split", "column");

	const [firstSessionId, secondSessionId, thirdSessionId] =
		await terminalSessionIds(page);
	await pushTerminalOutput(page, "left-pane-text", firstSessionId);
	await pushTerminalOutput(page, "top-right-pane-text", secondSessionId);
	await pushTerminalOutput(page, "bottom-right-pane-text", thirdSessionId);

	const leftPane = panes.filter({ hasText: "left-pane-text" });
	const topRightPane = panes.filter({ hasText: "top-right-pane-text" });
	const bottomRightPane = panes.filter({ hasText: "bottom-right-pane-text" });
	await expect(leftPane).toHaveCount(1);
	await expect(topRightPane).toHaveCount(1);
	await expect(bottomRightPane).toHaveCount(1);
	await expect(leftPane).not.toContainText("top-right-pane-text");
	await expect(leftPane).not.toContainText("bottom-right-pane-text");

	// Genuinely laid out row-then-column: the left pane is roughly half
	// width, and the top-right/bottom-right panes stack vertically within
	// that same half.
	const containerBox = await activePane.boundingBox();
	const leftBox = await leftPane.boundingBox();
	const topRightBox = await topRightPane.boundingBox();
	const bottomRightBox = await bottomRightPane.boundingBox();
	expect(containerBox).not.toBeNull();
	expect(leftBox).not.toBeNull();
	expect(topRightBox).not.toBeNull();
	expect(bottomRightBox).not.toBeNull();
	if (
		containerBox !== null &&
		leftBox !== null &&
		topRightBox !== null &&
		bottomRightBox !== null
	) {
		expect(leftBox.width).toBeLessThan(containerBox.width * 0.7);
		expect(topRightBox.width).toBeLessThan(containerBox.width * 0.7);
		expect(topRightBox.y).toBeLessThan(bottomRightBox.y);
	}

	expect(pageErrors).toEqual([]);
});

test("a nested split inherits the frozen root/profile/cwd of the pane it was split from, even after the future-tab defaults change again", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	// The profile/cwd controls are part of the terminal view's own tab
	// strip — they do not exist in the DOM until the view has actually been
	// rendered at least once (see the established F190 S2 tests above,
	// which all `createTerminal` first for the same reason).
	await createTerminal(page);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(1);

	const profileSelect = page.getByRole("combobox", {
		name: "Default Terminal Profile",
	});
	await profileSelect.selectOption("zsh");
	const cwdInput = page.getByRole("textbox", {
		name: "Default Terminal Working Directory",
	});
	await cwdInput.fill("nested/project");
	await cwdInput.blur();

	// A brand new tab freezes zsh/nested-project.
	await page.getByRole("button", { name: "New Terminal" }).click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(2);
	const startsAfterCreate = await terminalCallsFor(page, "terminal_start");
	expect(startsAfterCreate[1]?.args.request).toMatchObject({
		rootId: nativeRootId,
		profileId: "zsh",
		cwd: "nested/project",
	});

	// Change the future-tab defaults again *after* that tab is already
	// running — neither split below may ever pick these up. (This fixture's
	// `terminal_profiles` snapshot only ever issues `systemDefault`/`zsh` —
	// see that mock case's own comment — so `systemDefault` is the only
	// other value available to switch to.)
	await profileSelect.selectOption("systemDefault");
	await cwdInput.fill("somewhere/else");
	await cwdInput.blur();

	await page.getByRole("button", { name: "Split Terminal Right" }).click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(3);
	let starts = await terminalCallsFor(page, "terminal_start");
	expect(starts[2]?.args.request).toMatchObject({
		rootId: nativeRootId,
		profileId: "zsh",
		cwd: "nested/project",
	});

	// A second-level split — of the *new* pane the first split just
	// created, not the tab's original pane — must still inherit the same
	// originally-frozen values (pane-level, not merely tab-level,
	// inheritance).
	await page.getByRole("button", { name: "Split Terminal Down" }).click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(4);
	starts = await terminalCallsFor(page, "terminal_start");
	expect(starts[3]?.args.request).toMatchObject({
		rootId: nativeRootId,
		profileId: "zsh",
		cwd: "nested/project",
	});

	expect(pageErrors).toEqual([]);
});

test("reaching the 8-pane split limit disables the split controls and shows accurate feedback, with zero additional spawn on a further attempt", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(1);

	const splitRightButton = page.getByRole("button", {
		name: "Split Terminal Right",
	});
	// 7 splits: 1 pane -> 8 panes (this slice's cap).
	for (let i = 0; i < 7; i += 1) {
		await splitRightButton.click();
		await expect
			.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
			.toBe(i + 2);
	}

	const activePane = page.locator(
		'.plain-terminal-panecontainer[data-active="true"]',
	);
	await expect(activePane.locator(".plain-terminal-pane")).toHaveCount(8);

	// Accurate, visible, proactive feedback — never merely a silent no-op.
	await expect(splitRightButton).toBeDisabled();
	await expect(
		page.getByRole("button", { name: "Split Terminal Down" }),
	).toBeDisabled();
	await expect(page.locator(".plain-terminal-split-hint")).toHaveText(
		"This tab has reached its 8-pane split limit.",
	);

	// A command-palette-invoked split bypasses the disabled button entirely —
	// it must still spawn nothing and keep the same accurate feedback
	// visible, never fail silently.
	await executePaletteCommand(
		page,
		"Split Terminal Right",
		"Plain: Split Terminal Right",
	);
	expect(await terminalCallsFor(page, "terminal_start")).toHaveLength(8);
	await expect(activePane.locator(".plain-terminal-pane")).toHaveCount(8);
	await expect(page.locator(".plain-terminal-split-hint")).toHaveText(
		"This tab has reached its 8-pane split limit.",
	);

	expect(pageErrors).toEqual([]);
});

test("closing a middle pane promotes its sibling and leaves the other panes' sessions untouched", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(1);

	// Build: split(row){ pane-left, split(column){ pane-top-right, pane-bottom-right } }
	await page.getByRole("button", { name: "Split Terminal Right" }).click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(2);
	await page.getByRole("button", { name: "Split Terminal Down" }).click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(3);

	const [leftSessionId, topRightSessionId, bottomRightSessionId] =
		await terminalSessionIds(page);
	await pushTerminalOutput(page, "left-marker", leftSessionId);
	await pushTerminalOutput(page, "top-right-marker", topRightSessionId);
	await pushTerminalOutput(page, "bottom-right-marker", bottomRightSessionId);

	const activePane = page.locator(
		'.plain-terminal-panecontainer[data-active="true"]',
	);
	await expect(activePane.locator(".plain-terminal-split")).toHaveCount(2);

	// Close the *middle* pane (top-right) — deliberately not the currently
	// active one (bottom-right, the most recently split-off pane), via that
	// specific pane's own close button.
	const topRightPane = activePane
		.locator(".plain-terminal-pane")
		.filter({ hasText: "top-right-marker" });
	await topRightPane.getByRole("button", { name: "Close Pane" }).click();

	await expect(activePane.locator(".plain-terminal-pane")).toHaveCount(2);
	// The tree collapsed — the nested column split is gone, only the outer
	// split remains.
	await expect(activePane.locator(".plain-terminal-split")).toHaveCount(1);

	// Exactly the closed pane's session was killed.
	await expect
		.poll(async () =>
			terminalKillSessionIds(await terminalCallsFor(page, "terminal_kill")),
		)
		.toEqual([topRightSessionId]);
	// No new terminal_start calls happened because of this close.
	expect(await terminalCallsFor(page, "terminal_start")).toHaveLength(3);

	// The two survivors are still alive and independently addressable.
	await expect(
		activePane
			.locator(".plain-terminal-pane")
			.filter({ hasText: "left-marker" }),
	).toHaveCount(1);
	await expect(
		activePane
			.locator(".plain-terminal-pane")
			.filter({ hasText: "bottom-right-marker" }),
	).toHaveCount(1);
	await pushTerminalOutput(page, "-still-alive", leftSessionId);
	await pushTerminalOutput(page, "-still-alive", bottomRightSessionId);
	await expect(
		activePane
			.locator(".plain-terminal-pane")
			.filter({ hasText: "left-marker-still-alive" }),
	).toHaveCount(1);
	await expect(
		activePane
			.locator(".plain-terminal-pane")
			.filter({ hasText: "bottom-right-marker-still-alive" }),
	).toHaveCount(1);

	expect(pageErrors).toEqual([]);
});

test("splitting after switching the active pane targets the newly active pane, not the one that was active before", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(1);

	await page.getByRole("button", { name: "Split Terminal Right" }).click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(2);

	const [firstSessionId, secondSessionId] = await terminalSessionIds(page);
	await pushTerminalOutput(page, "left-marker", firstSessionId);
	await pushTerminalOutput(page, "right-marker", secondSessionId);

	const activePane = page.locator(
		'.plain-terminal-panecontainer[data-active="true"]',
	);
	const leftPane = activePane
		.locator(".plain-terminal-pane")
		.filter({ hasText: "left-marker" });
	const rightPane = activePane
		.locator(".plain-terminal-pane")
		.filter({ hasText: "right-marker" });

	// The just-created right pane is active right now.
	await expect(rightPane).toHaveAttribute("data-active", "true");
	await expect(leftPane).toHaveAttribute("data-active", "false");

	// Click into the left pane — a visible active-pane indicator (not just
	// internal bookkeeping) now moves to it.
	await leftPane.locator(".plain-terminal-surface-wrapper").click();
	await expect(leftPane).toHaveAttribute("data-active", "true");
	await expect(rightPane).toHaveAttribute("data-active", "false");

	// Splitting now must nest a new pane alongside the *left* pane — the
	// right pane is completely untouched.
	await page.getByRole("button", { name: "Split Terminal Down" }).click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(3);

	await expect(activePane.locator(".plain-terminal-pane")).toHaveCount(3);
	expect(await terminalCallsFor(page, "terminal_kill")).toEqual([]);
	await expect(rightPane).toContainText("right-marker");

	// The new pane is a sibling of the left pane specifically: both now live
	// under the same nested `.plain-terminal-split`, distinct from the
	// top-level split that still separates them from the right pane.
	const splits = activePane.locator(".plain-terminal-split");
	await expect(splits).toHaveCount(2);
	await expect(splits.nth(0)).toHaveAttribute("data-split", "row");
	await expect(splits.nth(1)).toHaveAttribute("data-split", "column");
	await expect(
		splits
			.nth(1)
			.locator(".plain-terminal-pane")
			.filter({ hasText: "right-marker" }),
	).toHaveCount(0);
	await expect(
		splits
			.nth(1)
			.locator(".plain-terminal-pane")
			.filter({ hasText: "left-marker" }),
	).toHaveCount(1);

	expect(pageErrors).toEqual([]);
});

// --- F190 S2: "future-tab defaults UI" (profile/cwd controls) -----------

test("setting default profile/cwd controls persists through settings.json and a new tab starts with them", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);

	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(1);
	const [firstStart] = await terminalCallsFor(page, "terminal_start");
	expect(firstStart?.args.request).toMatchObject({
		rootId: nativeRootId,
		profileId: "systemDefault",
		cwd: null,
	});

	const settingsWriteCount = async (): Promise<number> =>
		(await terminalCallsFor(page, "user_data_write")).filter(
			({ args }) =>
				(args.request as { resource?: unknown } | undefined)?.resource ===
				"settings",
		).length;

	const profileSelect = page.getByRole("combobox", {
		name: "Default Terminal Profile",
	});
	await expect(profileSelect).toBeVisible();
	await profileSelect.selectOption("zsh");
	await expect.poll(settingsWriteCount).toBe(1);

	const cwdInput = page.getByRole("textbox", {
		name: "Default Terminal Working Directory",
	});
	await cwdInput.fill("nested/project");
	await cwdInput.blur();
	await expect.poll(settingsWriteCount).toBe(2);

	const settingsWrites = (await terminalCallsFor(page, "user_data_write")).map(
		({ args }) => args.request as { content?: unknown },
	);
	expect(JSON.parse(String(settingsWrites[0]?.content))).toEqual({
		"plain.terminal.defaultProfile": "zsh",
	});
	expect(JSON.parse(String(settingsWrites[1]?.content))).toEqual({
		"plain.terminal.defaultProfile": "zsh",
		"plain.terminal.cwd": "nested/project",
	});

	await page.getByRole("button", { name: "New Terminal" }).click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(2);
	const starts = await terminalCallsFor(page, "terminal_start");
	expect(starts[1]?.args.request).toMatchObject({
		rootId: nativeRootId,
		profileId: "zsh",
		cwd: "nested/project",
	});

	expect(pageErrors).toEqual([]);
});

test("changing the profile/cwd defaults after a tab is already running never redirects that tab", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(1);
	const [firstSessionId] = await terminalSessionIds(page);

	const profileSelect = page.getByRole("combobox", {
		name: "Default Terminal Profile",
	});
	await profileSelect.selectOption("zsh");
	const cwdInput = page.getByRole("textbox", {
		name: "Default Terminal Working Directory",
	});
	await cwdInput.fill("nested/project");
	await cwdInput.blur();
	await expect
		.poll(
			async () =>
				(await terminalCallsFor(page, "user_data_write")).filter(
					({ args }) =>
						(args.request as { resource?: unknown } | undefined)?.resource ===
						"settings",
				).length,
		)
		.toBe(2);

	// The already-running tab must not restart, resize, or be killed just
	// because the *future*-tab defaults changed underneath it.
	expect(await terminalCallsFor(page, "terminal_start")).toHaveLength(1);
	expect(await terminalCallsFor(page, "terminal_kill")).toEqual([]);
	await pushTerminalOutput(page, "still-alive", firstSessionId);
	await expect(page.locator(".plain-terminal-grid")).toContainText(
		"still-alive",
	);

	// A brand-new tab, though, does pick up the new future-tab defaults.
	await page.getByRole("button", { name: "New Terminal" }).click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(2);
	const starts = await terminalCallsFor(page, "terminal_start");
	expect(starts[1]?.args.request).toMatchObject({
		profileId: "zsh",
		cwd: "nested/project",
	});

	expect(pageErrors).toEqual([]);
});

test("typing an illegal default cwd shows immediate feedback and never spawns a terminal or persists", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(1);

	const cwdInput = page.getByRole("textbox", {
		name: "Default Terminal Working Directory",
	});
	await cwdInput.fill("../escape");

	await expect(cwdInput).toHaveAttribute("data-invalid", "true");
	await expect(page.locator(".plain-terminal-cwd-hint")).toHaveText(
		'Cannot use ".." to leave the workspace root.',
	);

	// Typing alone never spawns a second terminal, and an illegal value is
	// never persisted — the one already-open tab's own start call stays the
	// only one, forever.
	expect(await terminalCallsFor(page, "terminal_start")).toHaveLength(1);
	expect(
		(await terminalCallsFor(page, "user_data_write")).filter(
			({ args }) =>
				(args.request as { resource?: unknown } | undefined)?.resource ===
				"settings",
		),
	).toEqual([]);

	expect(pageErrors).toEqual([]);
});

test("a hand-edited invalid persisted cwd default is rejected with an accurate, path-free status and zero spawn", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(1);

	// `settings.json` is only ever reachable through the settings UI's own
	// `validateFutureTabCwdInput` gate (see `plain-terminal-view.ts`), which
	// never persists an illegal value. A hand-edited file is the *only* way
	// an illegal default can ever land in configuration — simulated here by
	// editing `settings.json` directly through Plain's own raw-JSON settings
	// editor (the same real `user_data_write` persistence chain the settings
	// UI itself writes through), never through the profile/cwd controls.
	await executePaletteCommand(
		page,
		"Open Local Settings",
		"Plain: Open Local Settings (JSON)",
	);
	const settingsTab = page.locator(".tabs-container .tab.active");
	await expect(settingsTab).toContainText("settings.json");
	const secretPath = "/Users/someone/very-secret-directory";
	const settings = `{"plain.terminal.cwd":"${secretPath}"}`;
	await page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "{}" })
		.click();
	await page.keyboard.press("ControlOrMeta+A");
	await page.keyboard.type(settings);
	// Monaco keeps the quote/object auto-closers it created for the opening
	// characters when Playwright enters the full JSON quickly — the same
	// two stray trailing characters the "settings/keybindings survive save"
	// scenario elsewhere in this file already documents and strips the same
	// way.
	await page.keyboard.press("End");
	await page.keyboard.press("Backspace");
	await page.keyboard.press("Backspace");
	await page.keyboard.press("ControlOrMeta+S");
	await expect
		.poll(
			async () =>
				(await terminalCallsFor(page, "user_data_write")).filter(
					({ args }) =>
						(args.request as { resource?: unknown } | undefined)?.resource ===
						"settings",
				).length,
		)
		.toBe(1);
	await page.keyboard.press("ControlOrMeta+W");

	// This save (unlike an in-app `updateValue` call — see the two tests
	// above, which never need this) round-trips through the real, un-mocked
	// `WorkspaceService`'s own external-change reload machinery: the write
	// fires a file-change event that asynchronously reparses the file into
	// the live configuration model, with no test-observable completion
	// signal short of the effect this test is itself trying to observe. A
	// bounded wait is therefore the only available choice here — this is
	// eventual consistency of the pre-existing `F170` S1 persistence chain,
	// not a property `F190` S2 controls. The already-open first tab above
	// stays completely unaffected by this wait (its own session was already
	// frozen before this edit even started), so this delay cannot mask a
	// real regression in this slice's own "zero spawn" guarantee for the
	// *second* tab created below.
	await page.waitForTimeout(1_000);

	await page.getByRole("button", { name: "New Terminal" }).click();
	const secondTab = page.locator(".plain-terminal-tab", {
		hasText: "Terminal 2",
	});
	await expect(secondTab).toHaveCount(1);
	const activePaneStatus = page.locator(
		'.plain-terminal-panecontainer[data-active="true"] .plain-terminal-status',
	);
	await expect(activePaneStatus).toHaveText(
		"Must be relative to the workspace root, not an absolute path.",
	);
	// Only the first (baseline) tab ever spawned — the second tab, built
	// from the hand-edited invalid default, never called `terminal_start`.
	expect(await terminalCallsFor(page, "terminal_start")).toHaveLength(1);

	const bodyText = await page.locator(".plain-terminal-view-body").innerText();
	expect(bodyText).not.toContain(secretPath);
	expect(bodyText).not.toContain("/Users/someone");

	expect(pageErrors).toEqual([]);
});

// --- `F190` S4 "Ghostty metadata and links" ------------------------------

test("Cmd/Ctrl+Click opens an http(s) OSC 8 hyperlink through the audited opener, a plain click does not, and a non-http(s) scheme never becomes clickable", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(1);

	// Row 0: "link ftp text" — "link" (cols 0-3) gets an http(s) link, "ftp"
	// (cols 5-7) gets a non-audited scheme that must never render clickable.
	await pushTerminalOutput(page, "link ftp text");
	await setTerminalMetadata(page, {
		hyperlink: { row: 0, colStart: 0, colEnd: 4, uri: "https://example.com" },
	});
	await setTerminalMetadata(page, {
		hyperlink: { row: 0, colStart: 5, colEnd: 8, uri: "ftp://example.com" },
	});

	const grid = page.locator(".plain-terminal-grid");
	const httpLink = grid.locator(
		'[data-plain-terminal-link="https://example.com"]',
	);
	await expect(httpLink).toHaveCount(1);
	await expect(httpLink).toHaveClass(/plain-terminal-cell--link/);
	// The ftp-scheme cell is rendered as ordinary text: no clickable-link
	// data attribute anywhere else on the row.
	await expect(grid.locator("[data-plain-terminal-link]")).toHaveCount(1);

	// A plain click (no modifier) never opens anything.
	await httpLink.click();
	expect(await terminalCallsFor(page, "terminal_open_external_link")).toEqual(
		[],
	);

	// Cmd/Ctrl+Click does — the renderer checks `metaKey || ctrlKey` (either
	// satisfies it). "Meta" here, not "Control": on macOS a *physical*
	// Control+click is reinterpreted by the OS/Chromium input pipeline as a
	// secondary (context-menu) click and never reaches the page as an
	// ordinary "click" event at all — real Mac users use Cmd+Click for
	// exactly this reason, so "Meta" is the gesture that actually exercises
	// this renderer's own `metaKey || ctrlKey` branch on this runner's OS.
	await httpLink.click({ modifiers: ["Meta"] });
	await expect
		.poll(
			async () =>
				(await terminalCallsFor(page, "terminal_open_external_link")).length,
		)
		.toBe(1);
	const [openCall] = await terminalCallsFor(
		page,
		"terminal_open_external_link",
	);
	expect(openCall?.args.request).toMatchObject({ url: "https://example.com" });

	// The ftp span never carries `data-plain-terminal-link` at all, so even
	// a Cmd/Ctrl+Click on it triggers nothing further.
	const ftpSpan = grid.locator(".plain-terminal-cell", { hasText: "ftp" });
	await ftpSpan.click({ modifiers: ["Meta"] });
	expect(
		await terminalCallsFor(page, "terminal_open_external_link"),
	).toHaveLength(1);

	expect(pageErrors).toEqual([]);
});

test("OSC 133 semantic classification reflects in DOM classes and the prompt-navigation commands jump to and highlight the right row", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(1);

	// Row 0 = "$ ls" (a prompt line: "$ " is prompt text, "ls" is the typed
	// command), row 1 = "file.txt" (plain command output — the default
	// `"output"` classification, so it gets no extra semantic class).
	await pushTerminalOutput(page, "$ ls\n");
	await pushTerminalOutput(page, "file.txt\n");
	await setTerminalMetadata(page, {
		rowSemanticPrompt: { row: 0, kind: "prompt" },
	});
	await setTerminalMetadata(page, {
		semantic: { row: 0, colStart: 0, colEnd: 2, kind: "prompt" },
	});
	await setTerminalMetadata(page, {
		semantic: { row: 0, colStart: 2, colEnd: 4, kind: "input" },
	});

	const grid = page.locator(".plain-terminal-grid");
	// One span each: `groupRowRuns` merges adjacent same-styled cells into a
	// single `<span>` (see that function's own doc comment) — "$ " (cols 0-1,
	// both `"prompt"`) and "ls" (cols 2-3, both `"input"`) are each one
	// contiguous run.
	await expect(
		grid.locator(".plain-terminal-cell--semantic-prompt"),
	).toHaveCount(1);
	await expect(
		grid.locator(".plain-terminal-cell--semantic-input"),
	).toHaveCount(1);
	await expect(
		grid.locator(".plain-terminal-cell--semantic-prompt"),
	).toHaveText("$ ");
	await expect(grid.locator(".plain-terminal-cell--semantic-input")).toHaveText(
		"ls",
	);

	const promptRow = grid.locator(".plain-terminal-row").nth(0);
	await expect(promptRow).not.toHaveClass(/prompt-target/);

	await executePaletteCommand(
		page,
		"Jump to Previous Prompt",
		"Plain: Jump to Previous Prompt",
	);
	await expect(promptRow).toHaveClass(/plain-terminal-row--prompt-target/);

	// "Jump to Next Prompt" walks back toward the bottom — with only one
	// prompt row retained, there is nothing further "next" of it, so this
	// must not throw or move the highlight anywhere new.
	await executePaletteCommand(
		page,
		"Jump to Next Prompt",
		"Plain: Jump to Next Prompt",
	);
	await expect(promptRow).toHaveClass(/plain-terminal-row--prompt-target/);

	expect(pageErrors).toEqual([]);
});

test("OSC 7 pwd is reflected on the pane and becomes the next split's cwd candidate, re-validated by the mock", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(1);

	const activePane = page.locator(
		'.plain-terminal-panecontainer[data-active="true"] .plain-terminal-pane[data-active="true"]',
	);
	await setTerminalMetadata(page, { pwd: "nested/project" });
	await expect(activePane).toHaveAttribute(
		"data-terminal-pwd",
		"nested/project",
	);

	await page.getByRole("button", { name: "Split Terminal Right" }).click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(2);
	const starts = await terminalCallsFor(page, "terminal_start");
	// The mock's own `terminal_start` handler re-validates `cwd` exactly like
	// every other request (rejects an absolute path or a `..` escape — see
	// that case's own comment) — this call succeeding at all is that
	// re-validation, not merely a value being echoed back unchecked.
	expect(starts[1]?.args.request).toMatchObject({ cwd: "nested/project" });

	// A pwd that later moves outside the workspace root projects to `null`
	// (see `TerminalFrame.pwd`'s doc comment) — the pane's own display must
	// track that, not keep showing a stale candidate.
	await setTerminalMetadata(page, { pwd: null });
	await expect(activePane).not.toHaveAttribute("data-terminal-pwd");

	expect(pageErrors).toEqual([]);
});

test("shell-integration injection status is accurately observable: injected for the audited zsh/systemDefault families, degraded for an unsupported shell profile", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(1);

	const firstPane = page.locator(
		'.plain-terminal-panecontainer[data-active="true"] .plain-terminal-pane[data-active="true"]',
	);
	await expect(firstPane).toHaveAttribute(
		"data-terminal-shell-integration",
		"injected",
	);

	// `"sh"` is deliberately not one of the audited shell-integration
	// families (mirrors the real `shell_integration::ShellFamily` split —
	// see this fixture's own `terminal_start` case comment).
	const profileSelect = page.getByRole("combobox", {
		name: "Default Terminal Profile",
	});
	await profileSelect.selectOption("sh");
	await page.getByRole("button", { name: "New Terminal" }).click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(2);

	const secondPane = page.locator(
		'.plain-terminal-panecontainer[data-active="true"] .plain-terminal-pane[data-active="true"]',
	);
	await expect(secondPane).toHaveAttribute(
		"data-terminal-shell-integration",
		"unsupportedShell",
	);

	expect(pageErrors).toEqual([]);
});

// --- `F190` S6 "explicit non-restorable lifecycle": real exit banner and
// the one-time non-restorable notice ---------------------------------------

test("a real (non-killed) shell exit shows an accurate, path-free banner without closing the pane, further input is inert, and an explicit close afterward still works", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(1);

	// A normal exit: `exitCode` alone is the real, meaningful outcome.
	const pane = page.locator(".plain-terminal-pane");
	await emitTerminalProcessExit(page, 130);
	await expect(pane).toHaveAttribute("data-terminal-exited", "true");
	await expect(pane).toHaveAttribute("data-terminal-exit-code", "130");
	await expect(pane).not.toHaveAttribute("data-terminal-exit-signal");
	const status = page.locator(".plain-terminal-status");
	await expect(status).toHaveText(
		"The shell process exited with code 130. This session has ended and cannot be resumed — close this pane when you are done with it.",
	);
	expect(await status.innerText()).not.toMatch(/[/\\]/);
	// A real exit never auto-closes anything — the tab/pane stay exactly as
	// they were, still fully visible.
	await expect(page.locator(".plain-terminal-tab")).toHaveCount(1);
	await expect(pane).toBeVisible();

	// Typing into the now-dead session is a harmless no-op: no further
	// `terminal_input_key` call, and — the real point of this assertion —
	// no unhandled-rejection `pageerror` from a write against a session the
	// mock (mirroring real Rust) still remembers but nothing reads from
	// anymore.
	const inputKeyCallsBeforeTyping = (
		await terminalCallsFor(page, "terminal_input_key")
	).length;
	await page.locator(".plain-terminal-input").focus();
	await page.keyboard.type("still typing after exit");
	expect((await terminalCallsFor(page, "terminal_input_key")).length).toBe(
		inputKeyCallsBeforeTyping,
	);

	// Split, creating a second pane whose own session then exits by signal
	// — `exitCode` alone (`1`, `portable_pty`'s own meaningless placeholder
	// — see `TerminalExitEvent.signal`'s doc comment) must not be what the
	// banner leads with.
	await page.getByRole("button", { name: "Split Terminal Right" }).click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(2);
	const activePane = page.locator('.plain-terminal-pane[data-active="true"]');
	await emitTerminalProcessExit(page, 1, "Killed: 9");
	await expect(activePane).toHaveAttribute(
		"data-terminal-exit-signal",
		"Killed: 9",
	);
	const activeStatus = activePane.locator(".plain-terminal-status");
	await expect(activeStatus).toHaveText(
		"The shell process was terminated (Killed: 9). This session has ended and cannot be resumed — close this pane when you are done with it.",
	);
	expect(await activeStatus.innerText()).not.toContain("exited with code");

	// The user can still close an exited pane manually — the ordinary
	// explicit `terminal_kill` path is unaffected by an already-observed
	// exit.
	await activePane.locator(".plain-terminal-pane-close").click();
	await expect(page.locator(".plain-terminal-pane")).toHaveCount(1);
	expect(
		terminalKillSessionIds(await terminalCallsFor(page, "terminal_kill")),
	).toHaveLength(1);

	expect(pageErrors).toEqual([]);
});

test("an explicit pane close never shows a banner and decrements the lifecycle marker, so a later reload shows no non-restorable notice", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(1);
	await expect(
		page.locator(".plain-terminal-non-restorable-notice"),
	).toBeHidden();
	await expect(page.locator(".plain-terminal-status")).toHaveText("");

	// Explicit close — the ordinary kill+join path, unchanged semantics: no
	// exit banner (contrast the dedicated real-exit test above), and the
	// marker this close decrements must never resurface as a notice later.
	await page.locator(".plain-terminal-tab-close").click();
	await expect(page.locator(".plain-terminal-tab")).toHaveCount(0);
	expect(
		terminalKillSessionIds(await terminalCallsFor(page, "terminal_kill")),
	).toHaveLength(1);

	// Simulate the next cold start: reload re-runs this fixture's
	// `addInitScript` from scratch, but the lifecycle marker round-trips
	// through `sessionStorage`, which the reload itself preserves — see
	// `installNativeIpcMock`'s own `terminalLifecycleMarkerForTest` doc
	// comment.
	await page.reload();
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);
	await executePaletteCommand(page, "Open Folder", "File: Open Folder...");
	await createTerminal(page);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(1);
	await expect(
		page.locator(".plain-terminal-non-restorable-notice"),
	).toBeHidden();

	expect(pageErrors).toEqual([]);
});

test("an abnormal reload's leftover sessions show a one-time, path-free non-restorable notice that a second reload never repeats", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{},
		{},
		{},
		{},
		[],
		0,
		// `F190` S6: simulates 2 sessions the previous run left
		// un-explicitly-closed — a real abnormal `WebView` reload or crash.
		2,
	);
	await openNativeWorkspaceExplorer(page);

	// The notice must be visible the moment the terminal view first mounts
	// — `Plain: Create Terminal` also creates a real tab here (a workspace
	// root is already open), but the notice is not tied to that at all.
	await createTerminal(page);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(1);
	await expect(
		await terminalCallsFor(page, "terminal_lifecycle_marker"),
	).toHaveLength(1);

	const notice = page.locator(".plain-terminal-non-restorable-notice");
	await expect(notice).toBeVisible();
	await expect(notice).toContainText(
		"2 previous terminal sessions ended without being explicitly closed and could not be restored.",
	);
	expect(await notice.innerText()).not.toMatch(/[/\\]/);

	// User-dismissible.
	await notice.getByRole("button", { name: "Dismiss" }).click();
	await expect(notice).toBeHidden();

	// `createTerminal` above also created one real tab (a root was already
	// open) — its own session is itself now "open and un-explicitly-closed"
	// exactly like any other, so it must be closed explicitly before the
	// next reload, or *it* would correctly (not spuriously) reappear as a
	// fresh notice — that is a different, already-covered behavior (see
	// the dedicated explicit-close test above), not what this test itself
	// is about.
	await page.locator(".plain-terminal-tab-close").click();
	await expect(page.locator(".plain-terminal-tab")).toHaveCount(0);

	// The marker was already claimed by that first mount, and the one real
	// session it opened was just explicitly closed — a second, unrelated
	// reload must not show the notice again.
	await page.reload();
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);
	await executePaletteCommand(page, "Open Folder", "File: Open Folder...");
	await createTerminal(page);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(1);
	await expect(
		page.locator(".plain-terminal-non-restorable-notice"),
	).toBeHidden();

	expect(pageErrors).toEqual([]);
});

// --- F080 S2: SCM override introduction + PlainScmProvider ---------------

async function openScmView(page: Page): Promise<Locator> {
	const scmActivityIcon = page.getByRole("tab", { name: /^Source Control/ });
	await expect(scmActivityIcon).toHaveCount(1);
	await scmActivityIcon.click();
	const body = page.locator(".plain-scm-view-body");
	await expect(body).toBeVisible();
	return body;
}

test("Source Control is reachable from the Activity Bar and shows a clear disabled message for an untrusted workspace, never spawning git", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(page, "arrayBuffer");
	await openNativeWorkspaceExplorer(page);
	await openScmView(page);

	await expect(page.locator(".plain-scm-view-message")).toHaveText(
		/execution trust/,
	);
	await expect(
		page.locator(".plain-scm-view-changes .plain-scm-view-resource"),
	).toHaveCount(0);
	await expect(
		page.locator(".plain-scm-view-staged .plain-scm-view-resource"),
	).toHaveCount(0);
	expect(await terminalCallsFor(page, "git_status")).toEqual([]);

	expect(pageErrors).toEqual([]);
});

test("Source Control requires an explicit repository in a multi-root workspace and keeps reads, writes, and historical models root-bound", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});

	await installMultiRootNativeIpcMock(page);
	const explorer = await openNativeWorkspaceExplorer(page);
	await executePaletteCommand(
		page,
		"Add Folder to Workspace",
		"Workspaces: Add Folder to Workspace...",
	);
	await expect(
		explorer.getByRole("treeitem", { name: "plain-library", exact: true }),
	).toHaveCount(1);

	const body = await openScmView(page);
	const selector = body.getByRole("combobox", {
		name: "Source Control Repository",
	});
	await expect(selector).toBeEnabled();
	await expect(selector).toHaveValue("");
	await expect(page.locator(".plain-scm-view-message")).toHaveText(
		"Select a repository to use Source Control.",
	);
	await expect
		.poll(async () => (await terminalCallsFor(page, "git_status")).length)
		.toBe(0);

	await selector.selectOption(nativeRootId);
	await expect(page.locator(".plain-scm-view-branch")).toHaveText(
		"primary-main",
	);
	await expect(
		body.locator(".plain-scm-view-changes .plain-scm-view-resource"),
	).toContainText("primary-only.txt");
	let statusCalls = await terminalCallsFor(page, "git_status");
	expect(statusCalls.at(-1)?.args.rootId).toBe(nativeRootId);

	await selector.selectOption(nativeSecondaryRootId);
	await expect(page.locator(".plain-scm-view-branch")).toHaveText(
		"secondary-main",
	);
	const secondaryChanges = body.locator(
		".plain-scm-view-changes .plain-scm-view-resource",
	);
	await expect(secondaryChanges).toHaveCount(1);
	await expect(secondaryChanges).toContainText("secondary-only.txt");
	statusCalls = await terminalCallsFor(page, "git_status");
	expect(statusCalls.at(-1)?.args.rootId).toBe(nativeSecondaryRootId);

	await secondaryChanges
		.getByRole("button", { name: "Stage", exact: true })
		.click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "git_stage_paths")).length)
		.toBe(1);
	const [stageCall] = await terminalCallsFor(page, "git_stage_paths");
	expect(stageCall?.args.rootId).toBe(nativeSecondaryRootId);
	expect(stageCall?.args.request).toEqual({ paths: ["secondary-only.txt"] });
	await expect(secondaryChanges).toHaveCount(0);
	await expect(
		body.locator(".plain-scm-view-staged .plain-scm-view-resource"),
	).toContainText("secondary-only.txt");

	const [primaryText, secondaryText] = await page.evaluate(
		async ({ primaryRootId, secondaryRootId }) => {
			const resolve = (
				window as unknown as {
					__PLAIN_TEST_RESOLVE_GIT_TEXT__(
						rootId: string,
						rev: "head" | "index",
						path: string,
					): Promise<string | null>;
				}
			).__PLAIN_TEST_RESOLVE_GIT_TEXT__;
			return Promise.all([
				resolve(primaryRootId, "head", "same.txt"),
				resolve(secondaryRootId, "head", "same.txt"),
			]);
		},
		{
			primaryRootId: nativeRootId,
			secondaryRootId: nativeSecondaryRootId,
		},
	);
	expect(primaryText).toBe("primary:head:same.txt\n");
	expect(secondaryText).toBe("secondary:head:same.txt\n");

	await selector.selectOption(nativeRootId);
	await expect(page.locator(".plain-scm-view-branch")).toHaveText(
		"primary-main",
	);
	await expect(
		body.locator(".plain-scm-view-changes .plain-scm-view-resource"),
	).toContainText("primary-only.txt");
	await expect(
		body.locator(".plain-scm-view-staged .plain-scm-view-resource"),
	).toHaveCount(0);

	expect(errors).toEqual([]);
});

test("Source Control shows a clear disabled message for a trusted workspace that is not a Git repository", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{ noRepositoryForTest: true },
	);
	await openNativeWorkspaceExplorer(page);
	await openScmView(page);

	await expect(page.locator(".plain-scm-view-message")).toHaveText(
		/not a Git repository/,
	);

	expect(pageErrors).toEqual([]);
});

test("Source Control renders Changes and Staged Changes resource groups from a deterministic git status fixture, and opens a resource on click", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		// A real mock file at the same relative path a resource's `sourceUri`
		// resolves to, so clicking it below opens a genuine editor with real
		// content rather than a file-not-found error tab.
		{ "src/unstaged.ts": "console.log('unstaged');\n" },
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{
			branch: {
				oid: "1".repeat(40),
				head: "main",
				upstream: { name: "origin/main", ahead: 1, behind: 2 },
			},
			entries: [
				// Unstaged-only modification: Changes only.
				{ type: "ordinary", worktreeStatus: "M", path: "src/unstaged.ts" },
				// Staged-and-unstaged: both groups (real "MM" semantics).
				{
					type: "ordinary",
					indexStatus: "M",
					worktreeStatus: "M",
					path: "src/both.ts",
				},
				// Staged addition: Staged only.
				{ type: "ordinary", indexStatus: "A", path: "src/added.ts" },
				// Untracked: Changes only, synthetic "?" status.
				{ type: "untracked", path: "new-file.txt" },
				// Staged rename: Staged only, with an origPath tooltip.
				{
					type: "renameOrCopy",
					indexStatus: "R",
					path: "src/renamed-to.ts",
					origPath: "src/renamed-from.ts",
				},
				// Ignored: dropped entirely, appears in neither group.
				{ type: "ignored", path: "dist/" },
			],
		},
	);
	await openNativeWorkspaceExplorer(page);
	const body = await openScmView(page);

	await expect(page.locator(".plain-scm-view-message")).toHaveText("");
	await expect(page.locator(".plain-scm-view-branch")).toHaveText("main ↓2 ↑1");

	const changes = body.locator(
		".plain-scm-view-changes .plain-scm-view-resource",
	);
	const staged = body.locator(
		".plain-scm-view-staged .plain-scm-view-resource",
	);
	// Changes: unstaged.ts, both.ts, new-file.txt (ignored dropped).
	await expect(changes).toHaveCount(3);
	// Staged: both.ts, added.ts, renamed-to.ts.
	await expect(staged).toHaveCount(3);
	await expect(changes).toContainText([
		"src/unstaged.ts",
		"src/both.ts",
		"new-file.txt",
	]);
	await expect(staged).toContainText([
		"src/both.ts",
		"src/added.ts",
		"src/renamed-to.ts",
	]);

	const renamedButton = staged.getByText("src/renamed-to.ts");
	await expect(renamedButton).toHaveAttribute(
		"title",
		/Renamed \(from src\/renamed-from\.ts\)/,
	);

	await changes.getByText("src/unstaged.ts").click();
	const editorTab = page.getByRole("tab", { name: /^unstaged\.ts(?:,.*)?$/ });
	await expect(editorTab).toBeVisible();
	await expect(page.locator(".monaco-editor").last()).toContainText(
		"console.log('unstaged');",
	);

	expect(pageErrors).toEqual([]);
});

test("Plain: Refresh Source Control re-runs git_status for the already-open view", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await openScmView(page);
	await expect
		.poll(async () => (await terminalCallsFor(page, "git_status")).length)
		.toBe(1);

	await executePaletteCommand(
		page,
		"Refresh Source Control",
		"Plain: Refresh Source Control",
	);
	await expect
		.poll(async () => (await terminalCallsFor(page, "git_status")).length)
		.toBe(2);

	expect(pageErrors).toEqual([]);
});

test("git: read-only content is resolvable through the registered ITextModelContentProvider, for both head and index revisions", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{
			blobs: {
				"src/a.ts": {
					head: "export const a = 1;\n",
					index: "export const a = 2;\n",
				},
			},
		},
	);
	await openNativeWorkspaceExplorer(page);

	const headText = await page.evaluate(
		(rootId) =>
			(
				window as unknown as {
					__PLAIN_TEST_RESOLVE_GIT_TEXT__(
						rootId: string,
						rev: "head" | "index",
						path: string,
					): Promise<string | null>;
				}
			).__PLAIN_TEST_RESOLVE_GIT_TEXT__(rootId, "head", "src/a.ts"),
		nativeRootId,
	);
	expect(headText).toBe("export const a = 1;\n");

	const indexText = await page.evaluate(
		(rootId) =>
			(
				window as unknown as {
					__PLAIN_TEST_RESOLVE_GIT_TEXT__(
						rootId: string,
						rev: "head" | "index",
						path: string,
					): Promise<string | null>;
				}
			).__PLAIN_TEST_RESOLVE_GIT_TEXT__(rootId, "index", "src/a.ts"),
		nativeRootId,
	);
	expect(indexText).toBe("export const a = 2;\n");

	const calls = await terminalCallsFor(page, "git_show_blob");
	expect(calls.length).toBeGreaterThanOrEqual(2);

	expect(pageErrors).toEqual([]);
});

// --- F080 S3: stage/unstage/commit/discard --------------------------------

test("Stage moves a Working Tree resource into Staged Changes, and Unstage moves it back", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{
			entries: [
				{ type: "ordinary", worktreeStatus: "M", path: "src/unstaged.ts" },
			],
		},
	);
	await openNativeWorkspaceExplorer(page);
	const body = await openScmView(page);

	const changes = body.locator(
		".plain-scm-view-changes .plain-scm-view-resource",
	);
	const staged = body.locator(
		".plain-scm-view-staged .plain-scm-view-resource",
	);
	await expect(changes).toHaveCount(1);
	await expect(staged).toHaveCount(0);

	await changes.getByRole("button", { name: "Stage", exact: true }).click();

	await expect
		.poll(async () => (await terminalCallsFor(page, "git_stage_paths")).length)
		.toBe(1);
	await expect(changes).toHaveCount(0);
	await expect(staged).toHaveCount(1);
	await expect(staged).toContainText("src/unstaged.ts");

	const stageCall = (await terminalCallsFor(page, "git_stage_paths"))[0]!;
	expect(stageCall.args.request).toEqual({ paths: ["src/unstaged.ts"] });

	await staged.getByRole("button", { name: "Unstage", exact: true }).click();
	await expect
		.poll(
			async () => (await terminalCallsFor(page, "git_unstage_paths")).length,
		)
		.toBe(1);
	await expect(staged).toHaveCount(0);
	await expect(changes).toHaveCount(1);
	await expect(changes).toContainText("src/unstaged.ts");

	const unstageCall = (await terminalCallsFor(page, "git_unstage_paths"))[0]!;
	expect(unstageCall.args.request).toEqual({ paths: ["src/unstaged.ts"] });

	expect(pageErrors).toEqual([]);
});

test("Stage All and Unstage All act on every Working Tree/Staged resource at once", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{
			entries: [
				{ type: "ordinary", worktreeStatus: "M", path: "a.ts" },
				{ type: "ordinary", worktreeStatus: "M", path: "b.ts" },
			],
		},
	);
	await openNativeWorkspaceExplorer(page);
	const body = await openScmView(page);

	const changes = body.locator(
		".plain-scm-view-changes .plain-scm-view-resource",
	);
	const staged = body.locator(
		".plain-scm-view-staged .plain-scm-view-resource",
	);
	await expect(changes).toHaveCount(2);

	await page.getByRole("button", { name: "Stage All", exact: true }).click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "git_stage_paths")).length)
		.toBe(1);
	await expect(staged).toHaveCount(2);
	await expect(changes).toHaveCount(0);
	const stageAllCall = (await terminalCallsFor(page, "git_stage_paths"))[0]!;
	expect(stageAllCall.args.request).toEqual({ paths: ["a.ts", "b.ts"] });

	await page.getByRole("button", { name: "Unstage All", exact: true }).click();
	await expect
		.poll(
			async () => (await terminalCallsFor(page, "git_unstage_paths")).length,
		)
		.toBe(1);
	await expect(changes).toHaveCount(2);
	await expect(staged).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

test("Discard requires confirmation naming the affected file, performs no call when declined, and discards when confirmed", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{
			entries: [
				{ type: "ordinary", worktreeStatus: "M", path: "src/dirty.ts" },
			],
		},
	);
	await openNativeWorkspaceExplorer(page);
	const body = await openScmView(page);
	const changes = body.locator(
		".plain-scm-view-changes .plain-scm-view-resource",
	);
	await expect(changes).toHaveCount(1);

	// Decline: no bridge call at all, resource still present.
	await changes.getByRole("button", { name: "Discard", exact: true }).click();
	const declineDialog = page.getByRole("dialog");
	await expect(declineDialog).toBeVisible();
	await expect(declineDialog).toContainText(
		'Discard changes in "src/dirty.ts"?',
	);
	await expect(declineDialog).toContainText("This cannot be undone");
	await declineDialog
		.getByRole("button", { name: "Cancel", exact: true })
		.click();
	await expect(declineDialog).toHaveCount(0);
	expect(await terminalCallsFor(page, "git_discard_paths")).toEqual([]);
	await expect(changes).toHaveCount(1);

	// Confirm: exactly one call, resource removed from Changes.
	await changes.getByRole("button", { name: "Discard", exact: true }).click();
	const confirmDialog = page.getByRole("dialog");
	await expect(confirmDialog).toBeVisible();
	await confirmDialog
		.getByRole("button", { name: "Discard Changes", exact: true })
		.click();
	await expect(confirmDialog).toHaveCount(0);
	await expect
		.poll(
			async () => (await terminalCallsFor(page, "git_discard_paths")).length,
		)
		.toBe(1);
	await expect(changes).toHaveCount(0);
	const discardCall = (await terminalCallsFor(page, "git_discard_paths"))[0]!;
	expect(discardCall.args.request).toEqual({ paths: ["src/dirty.ts"] });

	expect(pageErrors).toEqual([]);
});

test("Discard All confirms once for every discardable file and excludes untracked entries", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{
			entries: [
				{ type: "ordinary", worktreeStatus: "M", path: "a.ts" },
				{ type: "ordinary", worktreeStatus: "M", path: "b.ts" },
				{ type: "untracked", path: "new.txt" },
			],
		},
	);
	await openNativeWorkspaceExplorer(page);
	const body = await openScmView(page);
	const changes = body.locator(
		".plain-scm-view-changes .plain-scm-view-resource",
	);
	await expect(changes).toHaveCount(3);

	await page.getByRole("button", { name: "Discard All", exact: true }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText("a.ts");
	await expect(dialog).toContainText("b.ts");
	await dialog
		.getByRole("button", { name: "Discard Changes", exact: true })
		.click();
	await expect(dialog).toHaveCount(0);

	await expect
		.poll(
			async () => (await terminalCallsFor(page, "git_discard_paths")).length,
		)
		.toBe(1);
	const call = (await terminalCallsFor(page, "git_discard_paths"))[0]!;
	// Untracked "new.txt" is never included — it has no index/HEAD version to
	// discard back to (mirrors `src-tauri/src/git/discard.rs`'s own scope).
	expect(call.args.request).toEqual({ paths: ["a.ts", "b.ts"] });
	await expect(changes).toHaveCount(1);
	await expect(changes).toContainText("new.txt");

	expect(pageErrors).toEqual([]);
});

test("commits the typed message via the Commit button, clears the input, and supports Amend", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{
			entries: [{ type: "ordinary", indexStatus: "M", path: "src/staged.ts" }],
		},
	);
	await openNativeWorkspaceExplorer(page);
	const body = await openScmView(page);

	const input = body.locator(".plain-scm-view-input");
	await input.fill("feat: a real commit message");
	await body.getByRole("button", { name: "Commit", exact: true }).click();

	await expect
		.poll(async () => (await terminalCallsFor(page, "git_commit")).length)
		.toBe(1);
	const commitCall = (await terminalCallsFor(page, "git_commit"))[0]!;
	expect(commitCall.args.request).toEqual({
		message: "feat: a real commit message",
		amend: false,
	});
	await expect(input).toHaveValue("");
	await expect(
		body.locator(".plain-scm-view-staged .plain-scm-view-resource"),
	).toHaveCount(0);

	// Amend: check the box, type a message, commit again.
	await input.fill("feat: amended message");
	await body.getByRole("checkbox", { name: "Amend" }).check();
	await body.getByRole("button", { name: "Commit", exact: true }).click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "git_commit")).length)
		.toBe(2);
	const amendCall = (await terminalCallsFor(page, "git_commit"))[1]!;
	expect(amendCall.args.request).toEqual({
		message: "feat: amended message",
		amend: true,
	});

	expect(pageErrors).toEqual([]);
});

// --- F080 S4: fetch/pull/push with mandatory preview+confirm --------------

test("Network fetch requires confirmation naming the upstream and ahead/behind counts, performs no call when declined, and fetches when confirmed", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{},
		{ upstream: "origin/main", ahead: 2, behind: 1 },
	);
	await openNativeWorkspaceExplorer(page);
	const body = await openScmView(page);

	// Decline: no bridge call at all.
	await body.getByRole("button", { name: "Fetch", exact: true }).click();
	const declineDialog = page.getByRole("dialog");
	await expect(declineDialog).toBeVisible();
	await expect(declineDialog).toContainText("Fetch from origin/main?");
	await expect(declineDialog).toContainText(
		"2 commit(s) ahead, 1 commit(s) behind.",
	);
	await declineDialog
		.getByRole("button", { name: "Cancel", exact: true })
		.click();
	await expect(declineDialog).toHaveCount(0);
	expect(await terminalCallsFor(page, "git_fetch")).toEqual([]);

	// Confirm: exactly one call.
	await body.getByRole("button", { name: "Fetch", exact: true }).click();
	const confirmDialog = page.getByRole("dialog");
	await expect(confirmDialog).toBeVisible();
	await confirmDialog
		.getByRole("button", { name: "Fetch", exact: true })
		.click();
	await expect(confirmDialog).toHaveCount(0);
	await expect
		.poll(async () => (await terminalCallsFor(page, "git_fetch")).length)
		.toBe(1);

	expect(pageErrors).toEqual([]);
});

test("Network push sends force: false when the Force checkbox is left unchecked", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{},
		{ upstream: "origin/main", ahead: 1, behind: 0 },
	);
	await openNativeWorkspaceExplorer(page);
	const body = await openScmView(page);

	await body.getByRole("button", { name: "Push", exact: true }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText("Push to origin/main?");
	await dialog.getByRole("button", { name: "Push", exact: true }).click();
	await expect(dialog).toHaveCount(0);

	await expect
		.poll(async () => (await terminalCallsFor(page, "git_push")).length)
		.toBe(1);
	const call = (await terminalCallsFor(page, "git_push"))[0]!;
	expect(call.args.request).toEqual({ force: false });

	expect(pageErrors).toEqual([]);
});

test("Network force push shows distinct wording naming --force-with-lease, has a distinct Force Push button, and sends force: true", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{},
		{ upstream: "origin/main", ahead: 1, behind: 0 },
	);
	await openNativeWorkspaceExplorer(page);
	const body = await openScmView(page);

	await body.getByRole("checkbox", { name: "Force Push (with lease)" }).check();
	await body.getByRole("button", { name: "Push", exact: true }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText("Force push to origin/main?");
	await expect(dialog).toContainText("--force-with-lease");
	await expect(dialog).toContainText("cannot be undone");
	// The two confirm dialogs must be distinguishable: an exact-name "Push"
	// query must not also match the force-push dialog's "Force Push" button.
	await expect(
		dialog.getByRole("button", { name: "Push", exact: true }),
	).toHaveCount(0);
	await dialog.getByRole("button", { name: "Force Push", exact: true }).click();
	await expect(dialog).toHaveCount(0);

	await expect
		.poll(async () => (await terminalCallsFor(page, "git_push")).length)
		.toBe(1);
	const call = (await terminalCallsFor(page, "git_push"))[0]!;
	expect(call.args.request).toEqual({ force: true });

	expect(pageErrors).toEqual([]);
});

test("Network pull fails closed when there is no upstream: no dialog ever appears, no bridge call is made, and a notification toast reports it", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{},
		{ upstream: null },
	);
	await openNativeWorkspaceExplorer(page);
	const body = await openScmView(page);

	await body.getByRole("button", { name: "Pull", exact: true }).click();

	const toasts = page.locator(".notifications-toasts .notification-toast");
	await expect(toasts).toHaveCount(1);
	await expect(toasts.first()).toContainText("no upstream configured");

	// The fail-closed contract this proves: the confirm dialog must never
	// have appeared, and the mutating bridge call must never have been made.
	// Scoped to `.monaco-dialog-box` (the real `IDialogService.confirm` modal's
	// own class) rather than a bare `page.getByRole("dialog")`: the
	// notification toast just asserted above is *itself* a `role="dialog"`
	// list row (`.monaco-list-row`, Monaco's list widget convention for rich
	// list items), so an unscoped role query would find that toast and
	// produce a false pass here.
	await expect(page.locator(".monaco-dialog-box")).toHaveCount(0);
	expect(await terminalCallsFor(page, "git_pull")).toEqual([]);

	expect(pageErrors).toEqual([]);
});

test("Network Cancel becomes enabled during an in-flight fetch and triggers git_network_cancel", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{},
		{ delayMs: 500 },
	);
	await openNativeWorkspaceExplorer(page);
	const body = await openScmView(page);

	const cancelButton = body.getByRole("button", {
		name: "Cancel",
		exact: true,
	});
	await expect(cancelButton).toBeDisabled();

	await body.getByRole("button", { name: "Fetch", exact: true }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: "Fetch", exact: true }).click();
	await expect(dialog).toHaveCount(0);

	// The fetch is now in flight (the mock's `git_fetch` handler is awaiting
	// its 500ms delay) — Cancel must be enabled for this whole window.
	await expect(cancelButton).toBeEnabled();
	await cancelButton.click();
	await expect
		.poll(
			async () => (await terminalCallsFor(page, "git_network_cancel")).length,
		)
		.toBe(1);

	// The mock does not actually interrupt the in-flight delayed promise (see
	// `TestGitNetworkFixture`'s own doc comment) — only that the cancel call
	// was made. Wait for the fetch to actually resolve on its own and confirm
	// Cancel goes back to disabled and nothing threw along the way.
	await expect
		.poll(async () => (await terminalCallsFor(page, "git_fetch")).length)
		.toBe(1);
	await expect(cancelButton).toBeDisabled();

	expect(pageErrors).toEqual([]);
});

test("Plain: Stage Selected Changes in Active File (Hunks) requires an explicit multi-pick and stages only the chosen hunk", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		// The working-tree (on-disk) content `workspaceReadFile` serves.
		{ "hunk.ts": "ONE\ntwo\nTHREE\n" },
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{
			entries: [{ type: "ordinary", worktreeStatus: "M", path: "hunk.ts" }],
			// The index version `gitShowBlob("index", …)` serves — two
			// independent hunks against the working-tree content above.
			blobs: { "hunk.ts": { index: "one\ntwo\nthree\n" } },
		},
	);
	await openNativeWorkspaceExplorer(page);
	const body = await openScmView(page);

	await body
		.locator(".plain-scm-view-changes .plain-scm-view-resource")
		.getByText("hunk.ts")
		.click();
	const editorTab = page.getByRole("tab", { name: /^hunk\.ts(?:,.*)?$/ });
	await expect(editorTab).toBeVisible();

	let picker = await openGitManagementCommand(
		page,
		"Stage Selected Changes",
		"Plain: Stage Selected Changes in Active File (Hunks)",
	);
	let hunkRows = picker.locator(".quick-input-list .monaco-list-row");
	await expect(hunkRows).toHaveCount(2);
	await expect(hunkRows.nth(0)).toContainText("Change 1");
	await expect(hunkRows.nth(0)).toContainText("one");
	await expect(hunkRows.nth(1)).toContainText("Change 2");
	await expect(hunkRows.nth(1)).toContainText("three");

	// Cancelling an untouched multi-picker must be strictly write-free.
	await page.keyboard.press("Escape");
	await expect(picker).toBeHidden();
	expect(await terminalCallsFor(page, "git_stage_blob")).toEqual([]);

	// A real workspace-byte change while the picker is open must make the
	// second snapshot stale and therefore remain write-free.
	picker = await openGitManagementCommand(
		page,
		"Stage Selected Changes",
		"Plain: Stage Selected Changes in Active File (Hunks)",
	);
	hunkRows = picker.locator(".quick-input-list .monaco-list-row");
	await expect(hunkRows).toHaveCount(2);
	const secondHunk = hunkRows.nth(1);
	const secondCheckbox = secondHunk.locator('[role="checkbox"]');
	await expect(secondCheckbox).toHaveCount(1);
	await secondCheckbox.click();
	await expect(secondCheckbox).toHaveAttribute("aria-checked", "true");
	await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_EXTERNAL_WRITE__(
				name: string,
				content: string,
				emitWake: boolean,
			): void;
		};
		testWindow.__PLAIN_TEST_EXTERNAL_WRITE__(
			"hunk.ts",
			"ONE\ntwo\nCHANGED WHILE SELECTING\n",
			false,
		);
	});
	await picker.getByRole("button", { name: "OK", exact: true }).click();
	await expect(picker).toBeHidden();
	await expect(
		page.locator(".notifications-toasts .notification-toast").filter({
			hasText: "changed while changes were being selected",
		}),
	).toHaveCount(1);
	expect(await terminalCallsFor(page, "git_stage_blob")).toEqual([]);

	// Restore the disk fixture, reopen, explicitly select only the second hunk,
	// and accept through the picker's real OK action.
	await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_EXTERNAL_WRITE__(
				name: string,
				content: string,
				emitWake: boolean,
			): void;
		};
		testWindow.__PLAIN_TEST_EXTERNAL_WRITE__(
			"hunk.ts",
			"ONE\ntwo\nTHREE\n",
			false,
		);
	});
	picker = await openGitManagementCommand(
		page,
		"Stage Selected Changes",
		"Plain: Stage Selected Changes in Active File (Hunks)",
	);
	hunkRows = picker.locator(".quick-input-list .monaco-list-row");
	await expect(hunkRows).toHaveCount(2);
	const finalSecondCheckbox = hunkRows.nth(1).locator('[role="checkbox"]');
	await finalSecondCheckbox.click();
	await expect(finalSecondCheckbox).toHaveAttribute("aria-checked", "true");
	await picker.getByRole("button", { name: "OK", exact: true }).click();
	await expect(picker).toBeHidden();

	await expect
		.poll(async () => (await terminalCallsFor(page, "git_stage_blob")).length)
		.toBe(1);
	const call = (await terminalCallsFor(page, "git_stage_blob"))[0]!;
	const request = call.args.request as { path: string; content: number[] };
	expect(request.path).toBe("hunk.ts");
	// Only the explicitly selected second hunk ("three" -> "THREE") applied;
	// the first remains at the index version. This proves the product did not
	// copy the whole working-tree file or silently retain the old index-0 path.
	expect(new TextDecoder().decode(new Uint8Array(request.content))).toBe(
		"one\ntwo\nTHREE\n",
	);

	expect(pageErrors).toEqual([]);
});

test("no AI/Chat-related SCM command exists in the command palette", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{ entries: [{ type: "unmerged", path: "src/conflict.ts" }] },
	);
	await openNativeWorkspaceExplorer(page);
	await openScmView(page);

	for (const label of [
		"Resolve Conflicts with AI",
		"Generate Commit Message",
		"View Source Control Graph",
	]) {
		await page.keyboard.press("ControlOrMeta+Shift+P");
		const palette = page.locator(".quick-input-widget");
		await expect(palette).toBeVisible();
		await palette.locator("input").fill(label);
		await expect(palette).not.toContainText(label);
		await page.keyboard.press("Escape");
	}

	const surfaceSnapshot = await page.evaluate(
		() => window.__PLAIN_WORKBENCH_SURFACES__,
	);
	expect(
		(surfaceSnapshot as { commandIds: readonly string[] } | undefined)
			?.commandIds ?? [],
	).not.toEqual(
		expect.arrayContaining([expect.stringMatching(/scm.*chat|chat.*scm/i)]),
	);

	expect(pageErrors).toEqual([]);
});

// --- F090 S6: Browser behavior coverage for the seven new views ------------
//
// S0-S5 each deliberately deferred this to Rust fixtures + frontend unit
// tests (see progress.md's own per-slice "有意收窄/未做的部分" notes) — this
// closing slice is what actually exercises blame/history/commit-detail/
// graph/refs/stash/worktree end to end against this file's own reproduced
// `native.ts` mock, the same way the F080 SCM tests above already do.

test("annotates lines with real inline git blame decorations and shows the full commit message on hover", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	const blameSha = "a1".repeat(20);
	// "2 days ago", with enough slack that the test's own real wall-clock
	// runtime can never cross a day boundary and change the bucket.
	const authorTime = Math.floor(Date.now() / 1000) - (2 * 86400 + 60);

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{ "src/blame.ts": "const one = 1;\nconst two = 2;" },
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{
			blame: {
				"src/blame.ts": {
					entries: [
						{
							commitSha: blameSha,
							isUncommitted: false,
							origLine: 1,
							finalLine: 1,
							isBoundary: false,
							filename: "src/blame.ts",
							previous: null,
						},
						{
							commitSha: blameSha,
							isUncommitted: false,
							origLine: 2,
							finalLine: 2,
							isBoundary: false,
							filename: "src/blame.ts",
							previous: null,
						},
					],
					commits: {
						[blameSha]: {
							author: "Ada Lovelace",
							authorMail: "<ada@example.com>",
							authorTime,
							authorTz: "+0000",
							committer: "Ada Lovelace",
							committerMail: "<ada@example.com>",
							committerTime: authorTime,
							committerTz: "+0000",
							summary: "add constants",
						},
					},
				},
			},
			blameCommitMessages: {
				[blameSha]:
					"add constants\n\nFull body explaining the two constants in detail.",
			},
		},
	);
	const explorer = await openNativeWorkspaceExplorer(page);
	const src = explorer.getByRole("treeitem", { name: "src", exact: true });
	await src.click();
	await page.keyboard.press("ArrowRight");
	await expect(src).toHaveAttribute("aria-expanded", "true");
	await explorer
		.getByRole("treeitem", { name: "blame.ts", exact: true })
		.dblclick();
	await expect(
		page.getByRole("tab", { name: /^blame\.ts(?:,.*)?$/ }),
	).toBeVisible();

	// Real data flow: the decoration text is built entirely from the
	// fixture's own author/summary/authorTime — not a placeholder — and the
	// age-heatmap bucket class reflects that same authorTime.
	const decoration = page.locator(".plain-git-blame-inline");
	await expect(decoration).toHaveCount(2);
	await expect(decoration.first()).toHaveText(
		"Ada Lovelace, 2 days ago • add constants",
	);
	await expect(decoration.first()).toHaveClass(/plain-git-blame-age-0/);
	await expect(decoration.last()).toHaveText(
		"Ada Lovelace, 2 days ago • add constants",
	);

	// Meaningful interaction: hovering the annotated line fetches and shows
	// the *full* commit message body via a real `git_blame_commit_messages`
	// round trip. The hover provider keys only by line number (not column),
	// so hovering the line's own real code text is enough to trigger it.
	const line = page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "const one = 1;" });
	await expect(line).toBeVisible();
	await line.hover();
	// Excludes the separate glyph-margin hover widget
	// (`editor.contrib.modesGlyphHoverWidget`) — a distinct `.monaco-hover`
	// element that always exists in the DOM (typically hidden) alongside the
	// content hover this test actually triggers.
	const hover = page.locator(
		'.monaco-hover:not([widgetid="editor.contrib.modesGlyphHoverWidget"])',
	);
	await expect(hover).toBeVisible({ timeout: 10_000 });
	await expect(hover).toContainText("Ada Lovelace");
	await expect(hover).toContainText(blameSha.slice(0, 7));
	await expect(hover).toContainText(
		"Full body explaining the two constants in detail.",
	);
	await expect
		.poll(
			async () =>
				(await terminalCallsFor(page, "git_blame_commit_messages")).length,
		)
		.toBeGreaterThan(0);

	expect(pageErrors).toEqual([]);
});

test("shows file history with the real commit list and drills into a specific line-history revision's own diff", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	const fileHistorySha1 = "b1".repeat(20);
	const fileHistorySha2 = "c2".repeat(20);
	const lineHistorySha = "d3".repeat(20);

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{ "src/history.ts": "first line\nsecond line\n" },
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{
			fileHistory: {
				"src/history.ts": {
					entries: [
						{
							sha: fileHistorySha1,
							message:
								"feat: add history\n\nAdds a real history entry for testing.",
						},
						{ sha: fileHistorySha2, message: "chore: init" },
					],
					truncated: false,
				},
			},
			lineHistoryList: {
				"src/history.ts": {
					entries: [{ sha: lineHistorySha, message: "fix: correct line 1" }],
					truncated: false,
				},
			},
			lineHistoryDetail: {
				[lineHistorySha]: {
					sha: lineHistorySha,
					diffText: "@@ -1 +1 @@\n-old first line\n+new first line\n",
				},
			},
		},
	);
	const explorer = await openNativeWorkspaceExplorer(page);
	const src = explorer.getByRole("treeitem", { name: "src", exact: true });
	await src.click();
	await page.keyboard.press("ArrowRight");
	await expect(src).toHaveAttribute("aria-expanded", "true");
	await explorer
		.getByRole("treeitem", { name: "history.ts", exact: true })
		.dblclick();
	await expect(
		page.getByRole("tab", { name: /^history\.ts(?:,.*)?$/ }),
	).toBeVisible();

	await openScmView(page);
	await page
		.getByRole("button", { name: "Show File History", exact: true })
		.click();

	const fileHistoryList = page.locator(".plain-git-history-view-list").first();
	const fileHistoryItems = fileHistoryList.locator(
		".plain-git-history-view-item",
	);
	await expect(fileHistoryItems).toHaveCount(2);
	await expect(fileHistoryItems.nth(0)).toContainText(
		fileHistorySha1.slice(0, 7),
	);
	await expect(fileHistoryItems.nth(0)).toContainText("feat: add history");
	await expect(fileHistoryItems.nth(1)).toContainText("chore: init");

	// Meaningful interaction 1: expanding a row reveals the *full* message
	// body (already fetched, no extra round trip) alongside a real "View
	// Changed Files" action that only appears once expanded.
	await fileHistoryItems
		.nth(0)
		.locator(".plain-git-history-view-item-row")
		.click();
	await expect(fileHistoryItems.nth(0)).toContainText(
		"Adds a real history entry for testing.",
	);
	await expect(
		fileHistoryItems
			.nth(0)
			.getByRole("button", { name: "View Changed Files", exact: true }),
	).toBeVisible();

	await page.getByLabel("Start Line").fill("1");
	await page.getByLabel("End Line").fill("1");
	await page
		.getByRole("button", { name: "Show Line History", exact: true })
		.click();

	const lineHistoryList = page.locator(".plain-git-history-view-list").nth(1);
	const lineHistoryItems = lineHistoryList.locator(
		".plain-git-history-view-item",
	);
	await expect(lineHistoryItems).toHaveCount(1);
	await expect(lineHistoryItems.first()).toContainText("fix: correct line 1");

	// Meaningful interaction 2: drilling into this specific revision fetches
	// and renders its *own* diff hunk text, verified against the exact fixed
	// fixture text (not merely "something appeared").
	await lineHistoryItems.first().click();
	await expect(page.locator(".plain-git-history-view-detail")).toHaveText(
		"@@ -1 +1 @@\n-old first line\n+new first line\n",
	);
	await expect
		.poll(
			async () =>
				(await terminalCallsFor(page, "git_line_history_detail")).length,
		)
		.toBe(1);
	const detailCall = (
		await terminalCallsFor(page, "git_line_history_detail")
	)[0]!;
	expect(detailCall.args.request).toEqual({
		path: "src/history.ts",
		range: { start: 1, end: 1 },
		skip: 0,
		expectedSha: lineHistorySha,
	});

	expect(pageErrors).toEqual([]);
});

test("opens a commit's changed files as a real multi-diff editor from the History view", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	const commitSha = "9c".repeat(20);
	const parentSha = "8b".repeat(20);

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{ "src/commit.ts": "touch file\n" },
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{
			fileHistory: {
				"src/commit.ts": {
					entries: [
						{
							sha: commitSha,
							message: "feat: multi-file change\n\nTouches three files.",
						},
					],
					truncated: false,
				},
			},
			showCommit: {
				[commitSha]: {
					sha: commitSha,
					parentSha,
					files: [
						{
							kind: "added",
							similarity: null,
							path: "src/added.ts",
							origPath: null,
							added: 5,
							deleted: 0,
							binary: false,
						},
						{
							kind: "deleted",
							similarity: null,
							path: "src/deleted.ts",
							origPath: null,
							added: 0,
							deleted: 3,
							binary: false,
						},
						{
							kind: "modified",
							similarity: null,
							path: "src/modified.ts",
							origPath: null,
							added: 2,
							deleted: 1,
							binary: false,
						},
					],
				},
			},
			commitBlobs: {
				[commitSha]: {
					"src/added.ts": "added content\n",
					"src/modified.ts": "after content\n",
				},
				[parentSha]: {
					"src/deleted.ts": "deleted content\n",
					"src/modified.ts": "before content\n",
				},
			},
		},
	);
	const explorer = await openNativeWorkspaceExplorer(page);
	const src = explorer.getByRole("treeitem", { name: "src", exact: true });
	await src.click();
	await page.keyboard.press("ArrowRight");
	await expect(src).toHaveAttribute("aria-expanded", "true");
	await explorer
		.getByRole("treeitem", { name: "commit.ts", exact: true })
		.dblclick();
	await expect(
		page.getByRole("tab", { name: /^commit\.ts(?:,.*)?$/ }),
	).toBeVisible();

	await openScmView(page);
	await page
		.getByRole("button", { name: "Show File History", exact: true })
		.click();
	const fileHistoryItem = page
		.locator(".plain-git-history-view-list")
		.first()
		.locator(".plain-git-history-view-item")
		.first();
	await expect(fileHistoryItem).toContainText("feat: multi-file change");
	await fileHistoryItem.locator(".plain-git-history-view-item-row").click();

	// Meaningful interaction: opening the changed-file list as a real
	// multi-diff editor, resolved by `PlainGitCommitMultiDiffSourceResolver`
	// through a real `git_show_commit` round trip.
	await fileHistoryItem
		.getByRole("button", { name: "View Changed Files", exact: true })
		.click();

	const commitTab = page.getByRole("tab", {
		name: new RegExp(`^Commit ${commitSha.slice(0, 7)}`),
	});
	await expect(commitTab).toBeVisible();
	const multiDiffEditor = page.locator(".monaco-component.multiDiffEditor");
	await expect(multiDiffEditor).toBeVisible();

	// Real data flow: three distinct file panes, one per `GitShowCommitResult`
	// file entry, titled with each file's own real basename — not a fixed
	// placeholder count.
	const fileTitles = multiDiffEditor.locator(".title.modified");
	await expect(fileTitles).toHaveCount(3);
	const titleTexts = await fileTitles.allTextContents();
	expect(titleTexts.some((text) => text.includes("added.ts"))).toBe(true);
	expect(titleTexts.some((text) => text.includes("deleted.ts"))).toBe(true);
	expect(titleTexts.some((text) => text.includes("modified.ts"))).toBe(true);

	await expect
		.poll(async () => (await terminalCallsFor(page, "git_show_commit")).length)
		.toBeGreaterThan(0);
	const showCommitCall = (await terminalCallsFor(page, "git_show_commit"))[0]!;
	expect(showCommitCall.args.request).toEqual({ sha: commitSha });

	expect(pageErrors).toEqual([]);
});

test("draws the commit graph with the correct swimlane count and lists branches, remote branches and tags with head/upstream markers", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	// A merge with two parents that themselves share a common base — the
	// smallest DAG shape that forces `computeGraphLayout` to actually open a
	// second swimlane (see `plain-git-graph-layout.ts`'s own algorithm doc
	// comment): merge -> [main, feature]; main -> base; feature -> base.
	const shaMerge = `${"1".repeat(36)}aaaa`;
	const shaMain = `${"2".repeat(36)}bbbb`;
	const shaFeature = `${"3".repeat(36)}cccc`;
	const shaBase = `${"4".repeat(36)}dddd`;

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{
			graphForTest: {
				nodes: [
					{
						sha: shaMerge,
						parents: [shaMain, shaFeature],
						subject: "Merge branch 'feature'",
					},
					{ sha: shaMain, parents: [shaBase], subject: "main commit" },
					{ sha: shaFeature, parents: [shaBase], subject: "feature commit" },
					{ sha: shaBase, parents: [], subject: "base commit" },
				],
				truncated: false,
			},
			refsForTest: {
				entries: [
					{
						kind: "branch",
						fullName: "refs/heads/main",
						shortName: "main",
						targetSha: shaMain,
						isAnnotatedTag: false,
						peeledSha: null,
						upstream: "origin/main",
						isHead: true,
					},
					{
						kind: "remoteBranch",
						fullName: "refs/remotes/origin/main",
						shortName: "origin/main",
						targetSha: shaMain,
						isAnnotatedTag: false,
						peeledSha: null,
						upstream: null,
						isHead: false,
					},
					{
						kind: "tag",
						fullName: "refs/tags/v1.0",
						shortName: "v1.0",
						targetSha: shaBase,
						isAnnotatedTag: false,
						peeledSha: null,
						upstream: null,
						isHead: false,
					},
				],
				truncated: false,
			},
		},
	);
	await openNativeWorkspaceExplorer(page);
	await openScmView(page);
	await page
		.getByRole("button", { name: "Refresh Graph", exact: true })
		.click();

	// Refs: real branches/remote-branches/tags lists, correctly grouped and
	// marked with the current HEAD and its upstream — not a static fixture
	// echoed verbatim (the grouping/sorting is real client-side logic).
	const refLists = page.locator(".plain-git-graph-view-ref-list");
	await expect(
		refLists.nth(0).locator(".plain-git-graph-view-ref-item"),
	).toHaveText(["* main -> origin/main"]);
	await expect(
		refLists.nth(1).locator(".plain-git-graph-view-ref-item"),
	).toHaveText(["origin/main"]);
	await expect(
		refLists.nth(2).locator(".plain-git-graph-view-ref-item"),
	).toHaveText(["v1.0"]);

	// Graph: the correct node count and, crucially, the correct *swimlane*
	// count — this is `computeGraphLayout`'s own real algorithm output, not
	// merely "some SVG rendered". Merge/main/base share lane 0; feature gets
	// its own lane 1, so exactly two distinct `cx` values should appear
	// across the four nodes.
	const svg = page.locator(".plain-git-graph-view-graph-scroll svg");
	const circles = svg.locator("circle");
	await expect(circles).toHaveCount(4);
	const cxValues = await circles.evaluateAll((nodes) =>
		nodes.map((node) => node.getAttribute("cx")),
	);
	expect(new Set(cxValues).size).toBe(2);

	// Each node is labeled with its own real subject and the ref badges that
	// actually join to it client-side (never git's own `%d`/`%D` decoration).
	const nodeTexts = await svg.locator("text").allTextContents();
	expect(
		nodeTexts.some((text) => text.includes("Merge branch 'feature'")),
	).toBe(true);
	expect(
		nodeTexts.some(
			(text) =>
				text.includes("main commit") && text.includes("[* main, origin/main]"),
		),
	).toBe(true);
	expect(nodeTexts.some((text) => text.includes("feature commit"))).toBe(true);
	expect(
		nodeTexts.some(
			(text) => text.includes("base commit") && text.includes("[tag: v1.0]"),
		),
	).toBe(true);

	expect(pageErrors).toEqual([]);
});

test("lists stash entries from a real fixture, shows a stash's changed files, and pops one after confirmation", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	const stashSha = "e5".repeat(20);
	const stashParentSha = "f6".repeat(20);

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{
			stashForTest: [
				{
					index: 0,
					sha: stashSha,
					committerTime: Math.floor(Date.now() / 1000),
					message: "WIP on main: fix login bug\n\nSome details.",
				},
			],
			stashShowForTest: {
				[stashSha]: {
					sha: stashSha,
					parentSha: stashParentSha,
					files: [
						{
							kind: "modified",
							similarity: null,
							path: "src/stashed.ts",
							origPath: null,
							added: 3,
							deleted: 1,
							binary: false,
						},
					],
				},
			},
		},
	);
	await openNativeWorkspaceExplorer(page);
	await openScmView(page);

	// Real data flow: the stash panel auto-loads on open (no button needed)
	// and its label is built from the fixture's own index + message.
	const entries = page.locator(".plain-git-stash-view-entry");
	await expect(entries).toHaveCount(1);
	await expect(page.locator(".plain-git-stash-view-entry-label")).toHaveText(
		"#0 — WIP on main: fix login bug",
	);

	// Meaningful interaction 1: Show renders this stash's own real changed
	// files (a genuine `git_stash_show` round trip), not a placeholder.
	await entries
		.first()
		.getByRole("button", { name: "Show", exact: true })
		.click();
	const detail = page.locator(".plain-git-stash-view-detail");
	await expect(detail).toContainText("src/stashed.ts");
	await expect(detail).toContainText("+3 -1");

	// Meaningful interaction 2: Pop always requires confirmation naming this
	// specific entry before ever calling `git_stash_pop`.
	await entries
		.first()
		.getByRole("button", { name: "Pop", exact: true })
		.click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText(
		"Pop stash #0 — WIP on main: fix login bug?",
	);
	await expect(dialog).toContainText("the stash entry is kept");
	expect(await terminalCallsFor(page, "git_stash_pop")).toEqual([]);
	await dialog.getByRole("button", { name: "Pop Stash", exact: true }).click();
	await expect(dialog).toHaveCount(0);

	await expect
		.poll(async () => (await terminalCallsFor(page, "git_stash_pop")).length)
		.toBe(1);
	const popCall = (await terminalCallsFor(page, "git_stash_pop"))[0]!;
	expect(popCall.args.request).toEqual({
		expectedSha: stashSha,
		useIndex: false,
	});
	await expect(entries).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

test("lists worktrees, adds a new one, and force-removes a dirty one after confirmation", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	const mainWorktreePath = "/workspace";
	const dirtyWorktreePath = "/workspace-worktrees/feature";

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{
			worktreesForTest: [
				{
					path: mainWorktreePath,
					headSha: "1".repeat(40),
					headState: { kind: "branch", refName: "refs/heads/main" },
					lockReason: null,
					prunableReason: null,
					isMain: true,
				},
				{
					path: dirtyWorktreePath,
					headSha: "2".repeat(40),
					headState: { kind: "branch", refName: "refs/heads/feature-branch" },
					lockReason: null,
					prunableReason: null,
					isMain: false,
				},
			],
			worktreeDirtyForTest: [dirtyWorktreePath],
		},
	);
	await openNativeWorkspaceExplorer(page);
	await openScmView(page);

	// Real data flow: the worktree panel auto-loads on open, labeling each
	// entry from its own real path/branch/isMain fields.
	const entries = page.locator(".plain-git-worktree-view-entry");
	await expect(entries).toHaveCount(2);
	const labels = page.locator(".plain-git-worktree-view-entry-label");
	await expect(labels).toHaveText([
		"main — main (/workspace)",
		"feature-branch (/workspace-worktrees/feature)",
	]);

	// Meaningful interaction 1: Add Worktree — no confirmation dialog (this
	// feature's own "低风险,不强确认" half), but a real new entry appears with
	// the exact path the mock's own `git_worktree_add` outcome reports.
	await page.getByLabel("New Worktree Folder Name").fill("new-feature");
	await page.getByRole("button", { name: "Add Worktree", exact: true }).click();
	await expect(entries).toHaveCount(3);
	await expect(page.locator(".plain-git-worktree-view-detail")).toHaveText(
		"Created worktree at /workspace-worktrees/new-feature",
	);
	await expect
		.poll(async () => (await terminalCallsFor(page, "git_worktree_add")).length)
		.toBe(1);
	const addCall = (await terminalCallsFor(page, "git_worktree_add"))[0]!;
	expect(addCall.args.request).toEqual({
		childSegment: "new-feature",
		detach: false,
		commitIsh: null,
	});

	// Meaningful interaction 2: Remove on a dirty worktree tries an unforced
	// removal first (no dialog yet), then requires explicit confirmation
	// before the forced retry that actually discards its changes.
	const dirtyEntry = page
		.locator(".plain-git-worktree-view-entry")
		.filter({ hasText: "feature-branch" });
	await dirtyEntry.getByRole("button", { name: "Remove", exact: true }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText(
		'Force remove worktree at "feature-branch (/workspace-worktrees/feature)"?',
	);
	await expect(dialog).toContainText("cannot be undone");
	await dialog
		.getByRole("button", { name: "Force Remove", exact: true })
		.click();
	await expect(dialog).toHaveCount(0);

	await expect
		.poll(
			async () => (await terminalCallsFor(page, "git_worktree_remove")).length,
		)
		.toBe(2);
	const removeCalls = await terminalCallsFor(page, "git_worktree_remove");
	expect(removeCalls[0]!.args.request).toEqual({
		path: dirtyWorktreePath,
		force: false,
	});
	expect(removeCalls[1]!.args.request).toEqual({
		path: dirtyWorktreePath,
		force: true,
	});
	await expect(entries).toHaveCount(2);
	await expect(labels).toHaveText([
		"main — main (/workspace)",
		"new-feature (/workspace-worktrees/new-feature)",
	]);

	expect(pageErrors).toEqual([]);
});

// --- F180 S2: ref/config management + product-owned Git invalidation ------

async function openGitManagementCommand(
	page: Page,
	query: string,
	label: string,
): Promise<Locator> {
	// The `>` Quick Open prefix selects the real CommandsQuickAccessProvider
	// deterministically without relying on host keyboard-layout translation of
	// Cmd/Ctrl+Shift+P.
	await page.keyboard.press("ControlOrMeta+P");
	const palette = page.locator(".quick-input-widget");
	await expect(palette).toBeVisible();
	await palette.locator("input").fill(`>${query}`);
	const command = palette.getByText(label, { exact: true });
	await expect(command).toHaveCount(1);
	await command.click();
	await expect(palette).toBeVisible();
	return palette;
}

async function pickGitManagementItem(
	palette: Locator,
	text: string,
): Promise<void> {
	const item = palette
		.locator(".quick-input-list .monaco-list-row")
		.filter({ hasText: text })
		.first();
	await expect(item).toBeVisible();
	await item.click();
}

async function submitGitManagementInput(
	palette: Locator,
	title: string,
	value: string,
): Promise<void> {
	await expect(palette).toContainText(title);
	const input = palette.locator("input");
	await input.fill(value);
	await input.press("Enter");
}

test("manages branches, tags, remotes and upstream through authoritative picks, confirmations and cross-view invalidation", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});

	const headSha = "a".repeat(40);
	const sideSha = "b".repeat(40);
	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{ "src/history.ts": "first line\n" },
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{
			branch: { oid: headSha, head: "main", upstream: null },
			fileHistory: {
				"src/history.ts": {
					entries: [{ sha: headSha, message: "initial history" }],
					truncated: false,
				},
			},
			refsForTest: {
				entries: [
					{
						kind: "branch",
						fullName: "refs/heads/main",
						shortName: "main",
						targetSha: headSha,
						isAnnotatedTag: false,
						peeledSha: null,
						upstream: null,
						isHead: true,
					},
					{
						kind: "branch",
						fullName: "refs/heads/unmerged",
						shortName: "unmerged",
						targetSha: sideSha,
						isAnnotatedTag: false,
						peeledSha: null,
						upstream: null,
						isHead: false,
					},
					{
						kind: "remoteBranch",
						fullName: "refs/remotes/origin/main",
						shortName: "origin/main",
						targetSha: headSha,
						isAnnotatedTag: false,
						peeledSha: null,
						upstream: null,
						isHead: false,
					},
					{
						kind: "tag",
						fullName: "refs/tags/existing",
						shortName: "existing",
						targetSha: headSha,
						isAnnotatedTag: false,
						peeledSha: null,
						upstream: null,
						isHead: false,
					},
				],
				truncated: false,
			},
			remotesForTest: {
				entries: [
					{
						name: "origin",
						fetchUrls: ["https://example.invalid/repo.git"],
						pushUrls: [],
					},
				],
				truncated: false,
			},
			branchUnmergedForTest: ["unmerged"],
		},
	);

	const explorer = await openNativeWorkspaceExplorer(page);
	const src = explorer.getByRole("treeitem", { name: "src", exact: true });
	await src.click();
	await page.keyboard.press("ArrowRight");
	await explorer
		.getByRole("treeitem", { name: "history.ts", exact: true })
		.dblclick();
	const scm = await openScmView(page);
	await page
		.getByRole("button", { name: "Show File History", exact: true })
		.click();
	await page
		.getByRole("button", { name: "Refresh Graph", exact: true })
		.click();
	const refLists = page.locator(".plain-git-graph-view-ref-list");
	await expect(refLists.nth(0)).toContainText("main");

	const callsBeforeInvalidation = Object.fromEntries(
		await Promise.all(
			[
				"git_status",
				"git_log_graph",
				"git_file_history",
				"git_stash_list",
				"git_worktree_list",
			].map(async (command) => [
				command,
				(await terminalCallsFor(page, command)).length,
			]),
		),
	) as Record<string, number>;

	let palette = await openGitManagementCommand(
		page,
		"Manage Branches",
		"Plain: Manage Branches",
	);
	await pickGitManagementItem(palette, "Create Branch…");
	await pickGitManagementItem(palette, "HEAD");
	await submitGitManagementInput(palette, "Create Branch", "feature");
	await expect(palette).toBeHidden();
	await expect
		.poll(
			async () => (await terminalCallsFor(page, "git_branch_create")).length,
		)
		.toBe(1);
	const branchCreate = (await terminalCallsFor(page, "git_branch_create"))[0]!;
	expect(branchCreate.args).toEqual({
		rootId: nativeRootId,
		request: { name: "feature", targetSha: headSha },
	});
	await expect(refLists.nth(0)).toContainText("feature");
	for (const [command, before] of Object.entries(callsBeforeInvalidation)) {
		await expect
			.poll(async () => (await terminalCallsFor(page, command)).length)
			.toBeGreaterThan(before);
	}

	palette = await openGitManagementCommand(
		page,
		"Manage Branches",
		"Plain: Manage Branches",
	);
	await pickGitManagementItem(palette, "feature");
	await pickGitManagementItem(palette, "Switch to Branch");
	await expect(scm.locator(".plain-scm-view-branch")).toHaveText("feature");

	palette = await openGitManagementCommand(
		page,
		"Manage Branches",
		"Plain: Manage Branches",
	);
	await pickGitManagementItem(palette, "* feature");
	await pickGitManagementItem(palette, "Rename Branch…");
	await submitGitManagementInput(
		palette,
		"Rename Branch: feature",
		"feature-renamed",
	);
	await expect(scm.locator(".plain-scm-view-branch")).toHaveText(
		"feature-renamed",
	);

	palette = await openGitManagementCommand(
		page,
		"Manage Branches",
		"Plain: Manage Branches",
	);
	await pickGitManagementItem(palette, "unmerged");
	await pickGitManagementItem(palette, "Delete Branch");
	let dialog = page.locator(".monaco-dialog-box");
	await expect(dialog).toContainText(
		'Force delete unmerged branch "unmerged"?',
	);
	expect(await terminalCallsFor(page, "git_branch_delete")).toHaveLength(1);
	expect(
		(await terminalCallsFor(page, "git_branch_delete"))[0]!.args.request,
	).toEqual({ name: "unmerged", force: false });
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(refLists.nth(0)).toContainText("unmerged");

	palette = await openGitManagementCommand(
		page,
		"Manage Branches",
		"Plain: Manage Branches",
	);
	await pickGitManagementItem(palette, "unmerged");
	await pickGitManagementItem(palette, "Delete Branch");
	dialog = page.locator(".monaco-dialog-box");
	await dialog
		.getByRole("button", { name: "Force Delete Branch", exact: true })
		.click();
	await expect
		.poll(
			async () => (await terminalCallsFor(page, "git_branch_delete")).length,
		)
		.toBe(3);
	const deleteCalls = await terminalCallsFor(page, "git_branch_delete");
	expect(deleteCalls.map((call) => call.args.request)).toEqual([
		{ name: "unmerged", force: false },
		{ name: "unmerged", force: false },
		{ name: "unmerged", force: true },
	]);
	await expect(refLists.nth(0)).not.toContainText("unmerged");

	palette = await openGitManagementCommand(
		page,
		"Manage Tags",
		"Plain: Manage Tags",
	);
	await pickGitManagementItem(palette, "Create Lightweight Tag…");
	await pickGitManagementItem(palette, "HEAD");
	await submitGitManagementInput(palette, "Create Tag", "v-light");
	await expect
		.poll(async () => (await terminalCallsFor(page, "git_tag_create")).length)
		.toBe(1);
	expect(
		(await terminalCallsFor(page, "git_tag_create"))[0]!.args.request,
	).toEqual({ name: "v-light", targetSha: headSha, message: null });

	palette = await openGitManagementCommand(
		page,
		"Manage Tags",
		"Plain: Manage Tags",
	);
	await pickGitManagementItem(palette, "Create Annotated Tag…");
	await pickGitManagementItem(palette, "HEAD");
	await submitGitManagementInput(palette, "Create Tag", "v2");
	await submitGitManagementInput(palette, "Annotated Tag: v2", "release two");
	await expect(refLists.nth(2)).toContainText("v2");
	expect(
		(await terminalCallsFor(page, "git_tag_create"))[1]!.args.request,
	).toEqual({ name: "v2", targetSha: headSha, message: "release two" });

	palette = await openGitManagementCommand(
		page,
		"Manage Tags",
		"Plain: Manage Tags",
	);
	await pickGitManagementItem(palette, "Delete v2");
	dialog = page.locator(".monaco-dialog-box");
	await expect(dialog).toContainText(`Target: ${headSha}`);
	expect(await terminalCallsFor(page, "git_tag_delete")).toHaveLength(0);
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	palette = await openGitManagementCommand(
		page,
		"Manage Tags",
		"Plain: Manage Tags",
	);
	await pickGitManagementItem(palette, "Delete v2");
	dialog = page.locator(".monaco-dialog-box");
	await dialog.getByRole("button", { name: "Delete Tag", exact: true }).click();
	await expect(refLists.nth(2)).not.toContainText("v2");

	palette = await openGitManagementCommand(
		page,
		"Manage Remotes",
		"Plain: Manage Remotes",
	);
	await pickGitManagementItem(palette, "Add Remote…");
	await submitGitManagementInput(palette, "Add Remote", "mirror");
	await submitGitManagementInput(
		palette,
		"Remote URL: mirror",
		"ssh://mirror.invalid/repo.git",
	);
	palette = await openGitManagementCommand(
		page,
		"Manage Remotes",
		"Plain: Manage Remotes",
	);
	await pickGitManagementItem(palette, "mirror");
	await pickGitManagementItem(palette, "Rename Remote…");
	await submitGitManagementInput(
		palette,
		"Rename Remote: mirror",
		"mirror-renamed",
	);
	expect(
		(await terminalCallsFor(page, "git_remote_rename"))[0]!.args.request,
	).toEqual({ oldName: "mirror", newName: "mirror-renamed" });

	const rawRemoteUrl =
		"https://token:secret@example.invalid/new.git?access_token=private";
	palette = await openGitManagementCommand(
		page,
		"Manage Remotes",
		"Plain: Manage Remotes",
	);
	await pickGitManagementItem(palette, "origin");
	await pickGitManagementItem(palette, "Change Fetch URL…");
	await submitGitManagementInput(
		palette,
		"Change Fetch URL: origin",
		rawRemoteUrl,
	);
	dialog = page.locator(".monaco-dialog-box");
	await expect(dialog).toContainText(
		"https://<redacted>@example.invalid/new.git?<redacted>",
	);
	await expect(dialog).not.toContainText("secret");
	await expect(dialog).not.toContainText("private");
	expect(await terminalCallsFor(page, "git_remote_set_url")).toHaveLength(0);
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

	palette = await openGitManagementCommand(
		page,
		"Manage Remotes",
		"Plain: Manage Remotes",
	);
	await pickGitManagementItem(palette, "origin");
	await pickGitManagementItem(palette, "Change Fetch URL…");
	await submitGitManagementInput(
		palette,
		"Change Fetch URL: origin",
		rawRemoteUrl,
	);
	dialog = page.locator(".monaco-dialog-box");
	await dialog.getByRole("button", { name: "Change URL", exact: true }).click();
	await expect
		.poll(
			async () => (await terminalCallsFor(page, "git_remote_set_url")).length,
		)
		.toBe(1);
	expect(
		(await terminalCallsFor(page, "git_remote_set_url"))[0]!.args.request,
	).toEqual({ name: "origin", kind: "fetch", url: rawRemoteUrl });

	palette = await openGitManagementCommand(
		page,
		"Manage Remotes",
		"Plain: Manage Remotes",
	);
	await pickGitManagementItem(palette, "mirror-renamed");
	await pickGitManagementItem(palette, "Remove Remote");
	dialog = page.locator(".monaco-dialog-box");
	await expect(dialog).toContainText("remote-tracking refs");
	expect(await terminalCallsFor(page, "git_remote_remove")).toHaveLength(0);
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	palette = await openGitManagementCommand(
		page,
		"Manage Remotes",
		"Plain: Manage Remotes",
	);
	await pickGitManagementItem(palette, "mirror-renamed");
	await pickGitManagementItem(palette, "Remove Remote");
	dialog = page.locator(".monaco-dialog-box");
	await dialog
		.getByRole("button", { name: "Remove Remote", exact: true })
		.click();
	await expect
		.poll(
			async () => (await terminalCallsFor(page, "git_remote_remove")).length,
		)
		.toBe(1);

	palette = await openGitManagementCommand(
		page,
		"Manage Upstream",
		"Plain: Manage Upstream",
	);
	await pickGitManagementItem(palette, "feature-renamed");
	await pickGitManagementItem(palette, "Set Upstream…");
	await pickGitManagementItem(palette, "origin/main");
	await expect(refLists.nth(0)).toContainText(
		"* feature-renamed -> origin/main",
	);
	expect(
		(await terminalCallsFor(page, "git_upstream_set"))[0]!.args.request,
	).toEqual({ branch: "feature-renamed", upstream: "origin/main" });

	palette = await openGitManagementCommand(
		page,
		"Manage Upstream",
		"Plain: Manage Upstream",
	);
	await pickGitManagementItem(palette, "feature-renamed");
	await pickGitManagementItem(palette, "Unset Upstream");
	await expect(refLists.nth(0)).not.toContainText("-> origin/main");
	expect(
		(await terminalCallsFor(page, "git_upstream_unset"))[0]!.args.request,
	).toEqual({ branch: "feature-renamed" });

	expect(errors).toEqual([]);
});

test("requires an explicit repository for Git management in a multi-root workspace and binds the mutation to that root", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});

	await installMultiRootNativeIpcMock(page);
	await openNativeWorkspaceExplorer(page);
	await executePaletteCommand(
		page,
		"Add Folder to Workspace",
		"Workspaces: Add Folder to Workspace...",
	);

	const palette = await openGitManagementCommand(
		page,
		"Manage Branches",
		"Plain: Manage Branches",
	);
	await pickGitManagementItem(palette, "plain-library");
	await pickGitManagementItem(palette, "Create Branch…");
	await pickGitManagementItem(palette, "HEAD");
	await submitGitManagementInput(palette, "Create Branch", "secondary-feature");

	await expect
		.poll(
			async () => (await terminalCallsFor(page, "git_branch_create")).length,
		)
		.toBe(1);
	const call = (await terminalCallsFor(page, "git_branch_create"))[0]!;
	expect(call.args).toEqual({
		rootId: nativeSecondaryRootId,
		request: {
			name: "secondary-feature",
			targetSha: "2".repeat(40),
		},
	});
	expect(errors).toEqual([]);
});

// --- F180 S4: history actions, recovery and cancellation ------------------

test("runs preview-confirmed history actions, reflog/contributors, conflict recovery and in-flight cancellation", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});

	const headSha = "a".repeat(40);
	const featureSha = "b".repeat(40);
	const reflogSha = "c".repeat(40);
	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{
			branch: { oid: headSha, head: "main", upstream: null },
			entries: [
				{
					type: "ordinary",
					indexStatus: "M",
					worktreeStatus: "M",
					path: "tracked-change.txt",
				},
			],
			graphForTest: {
				nodes: [
					{ sha: headSha, parents: [featureSha], subject: "current" },
					{ sha: featureSha, parents: [], subject: "feature commit" },
				],
				truncated: false,
			},
			refsForTest: {
				entries: [
					{
						kind: "branch",
						fullName: "refs/heads/main",
						shortName: "main",
						targetSha: headSha,
						isAnnotatedTag: false,
						peeledSha: null,
						upstream: null,
						isHead: true,
					},
					{
						kind: "branch",
						fullName: "refs/heads/feature",
						shortName: "feature",
						targetSha: featureSha,
						isAnnotatedTag: false,
						peeledSha: null,
						upstream: null,
						isHead: false,
					},
				],
				truncated: false,
			},
			reflogForTest: {
				entries: [
					{
						sha: reflogSha,
						selector: "HEAD@{1}",
						committerTime: 1_700_000_000,
						summary: "orphaned work",
					},
				],
				truncated: false,
			},
			contributorsForTest: {
				entries: [{ name: "Ada", email: "ada@example.invalid", commits: 3 }],
				truncated: false,
			},
			historyConflictForTest: {
				cherryPick: ["conflicted.txt"],
				rebase: ["conflicted.txt"],
			},
			historyDelayMsForTest: 800,
		},
	);
	await openNativeWorkspaceExplorer(page);

	let palette = await openGitManagementCommand(
		page,
		"Show Reflog",
		"Plain: Show Reflog",
	);
	await expect(palette).toContainText("HEAD@{1} orphaned work");
	await expect(palette).toContainText("ccccccc");
	await page.keyboard.press("Escape");

	palette = await openGitManagementCommand(
		page,
		"Show Contributors",
		"Plain: Show Contributors",
	);
	await expect(palette).toContainText("Ada");
	await expect(palette).toContainText("ada@example.invalid");
	await expect(palette).toContainText("3 commits");
	await page.keyboard.press("Escape");

	// Hard Reset gets the distinct destructive preview; Cancel remains write-free.
	palette = await openGitManagementCommand(page, "Reset", "Plain: Reset");
	await pickGitManagementItem(palette, "Hard Reset");
	await pickGitManagementItem(palette, "feature");
	let dialog = page.locator(".monaco-dialog-box");
	await expect(dialog).toContainText(
		"Tracked local paths that will be discarded (1):",
	);
	await expect(dialog).toContainText("tracked-change.txt");
	await expect(dialog).toContainText("Untracked files are not deleted");
	await expect(
		dialog.getByRole("button", {
			name: "Hard Reset and Discard Tracked Changes",
			exact: true,
		}),
	).toBeVisible();
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	expect(await terminalCallsFor(page, "git_reset")).toHaveLength(0);

	// A structured cherry-pick conflict publishes invalidation and Continue is
	// bound to the freshly-read `cherryPick` sequencer kind.
	palette = await openGitManagementCommand(
		page,
		"Cherry-Pick",
		"Plain: Cherry-Pick",
	);
	await pickGitManagementItem(palette, "feature");
	dialog = page.locator(".monaco-dialog-box");
	await expect(dialog).toContainText(`Target: ${featureSha}`);
	await dialog
		.getByRole("button", { name: "Cherry-Pick", exact: true })
		.click();
	const conflictToast = page
		.locator(".notifications-toasts .notification-toast")
		.filter({ hasText: "stopped with conflicts" });
	await expect(conflictToast).toContainText("conflicted.txt");
	await executePaletteCommand(
		page,
		"Continue Git Operation",
		"Plain: Continue Git Operation",
	);
	await expect
		.poll(
			async () => (await terminalCallsFor(page, "git_history_continue")).length,
		)
		.toBe(1);
	expect(
		(await terminalCallsFor(page, "git_history_continue"))[0]!.args.request,
	).toEqual({ kind: "cherryPick" });

	// Rebase conflict recovery has a separate Abort confirmation. Cancelling
	// that dialog performs no abort; confirming a second attempt does.
	palette = await openGitManagementCommand(page, "Rebase", "Plain: Rebase");
	await pickGitManagementItem(palette, "feature");
	dialog = page.locator(".monaco-dialog-box");
	await dialog.getByRole("button", { name: "Rebase", exact: true }).click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "git_rebase")).length)
		.toBe(1);
	await expect(
		page
			.locator(".notifications-toasts .notification-toast")
			.filter({ hasText: "Rebase stopped with conflicts" }),
	).toHaveCount(1);
	await executePaletteCommand(
		page,
		"Abort Git Operation",
		"Plain: Abort Git Operation",
	);
	dialog = page.locator(".monaco-dialog-box");
	await expect(dialog).toContainText("Abort the current rebase?");
	await expect(dialog).toContainText("conflicted.txt");
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	expect(await terminalCallsFor(page, "git_history_abort")).toHaveLength(0);
	await executePaletteCommand(
		page,
		"Abort Git Operation",
		"Plain: Abort Git Operation",
	);
	dialog = page.locator(".monaco-dialog-box");
	await dialog
		.getByRole("button", { name: "Abort Git Operation", exact: true })
		.click();
	await expect
		.poll(
			async () => (await terminalCallsFor(page, "git_history_abort")).length,
		)
		.toBe(1);
	expect(
		(await terminalCallsFor(page, "git_history_abort"))[0]!.args.request,
	).toEqual({ kind: "rebase" });

	// Start a genuinely delayed merge, then invoke the distinct Cancel command
	// while its native promise remains unresolved. The eventual outcome must say
	// cancelled without claiming rollback.
	palette = await openGitManagementCommand(page, "Merge", "Plain: Merge");
	await pickGitManagementItem(palette, "feature");
	dialog = page.locator(".monaco-dialog-box");
	await dialog.getByRole("button", { name: "Merge", exact: true }).click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "git_merge")).length)
		.toBe(1);
	await executePaletteCommand(
		page,
		"Cancel Git Operation",
		"Plain: Cancel Git Operation",
	);
	await expect
		.poll(
			async () => (await terminalCallsFor(page, "git_history_cancel")).length,
		)
		.toBe(1);
	await expect(
		page
			.locator(".notifications-toasts .notification-toast")
			.filter({ hasText: "Merge was cancelled" }),
	).toContainText("cancellation did not imply rollback");

	const historyCalls = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
			({ command }) =>
				command.startsWith("git_history_") ||
				["git_merge", "git_rebase", "git_cherry_pick", "git_reset"].includes(
					command,
				),
		);
	});
	expect(
		historyCalls.filter(({ command }) => command === "git_history_preview")
			.length,
	).toBe(4);
	expect(
		historyCalls.filter(({ command }) => command === "git_history_cancel")[0]!
			.args,
	).toEqual({ rootId: nativeRootId, request: {} });
	expect(errors).toEqual([
		"Plain: Cherry-Pick stopped with conflicts. Resolve: conflicted.txt. Use Continue or Abort Git Operation after reviewing the repository.",
		"Plain: Rebase stopped with conflicts. Resolve: conflicted.txt. Use Continue or Abort Git Operation after reviewing the repository.",
	]);
});

// --- `F100` S3 "断点 + 调用栈 + 变量/Watch" ----------------------------------

const DEBUG_LAUNCH_JSON = JSON.stringify({
	version: "0.2.0",
	configurations: [
		{
			type: "python",
			request: "launch",
			name: "Debug main.py",
			plainAdapter: {
				transport: "stdio",
				command: "/usr/bin/python3",
				args: ["-m", "debugpy.adapter"],
			},
			program: "main.py",
		},
	],
});

// `F210` S1: a second launch.json fixture carrying two configurations of
// distinct `type`/command/args (and a distinct `launchArguments` field, only
// the second configuration's `stopOnEntry`) — proves the configuration picker
// forwards the exact user-selected configuration through to `debug_launch`,
// never silently `configurations[0]`.
const TWO_LAUNCH_CONFIGURATIONS_JSON = JSON.stringify({
	version: "0.2.0",
	configurations: [
		{
			type: "python",
			request: "launch",
			name: "Debug main.py",
			plainAdapter: {
				transport: "stdio",
				command: "/usr/bin/python3",
				args: ["-m", "debugpy.adapter"],
			},
			program: "main.py",
		},
		{
			type: "node",
			request: "launch",
			name: "Debug server.js",
			plainAdapter: {
				transport: "stdio",
				command: "/usr/bin/node-debug-adapter",
				args: ["--inspect-brk"],
			},
			program: "server.js",
			stopOnEntry: true,
		},
	],
});

// Line 6 is `    total = add(3, 4)` — the line every breakpoint test below
// places its breakpoint on.
const DEBUG_MAIN_PY =
	"def add(a, b):\n    return a + b\n\n\ndef main():\n    total = add(3, 4)\n    print(total)\n\n\nmain()\n";

async function openRunAndDebugView(page: Page): Promise<void> {
	const activityIcon = page.getByRole("tab", { name: /^Run and Debug/ });
	await expect(activityIcon).toHaveCount(1);
	await activityIcon.click();
}

async function openMainPy(page: Page): Promise<void> {
	const explorer = await openNativeWorkspaceExplorer(page);
	await explorer
		.getByRole("treeitem", { name: "main.py", exact: true })
		.dblclick();
	await expect(
		page.getByRole("tab", { name: /^main\.py(?:,.*)?$/ }),
	).toBeVisible();
}

/** Clicks (left, or right for the breakpoint context menu) inside the
 * Monaco glyph margin at `lineText`'s vertical position — this project's
 * first test ever to interact with the glyph margin, so there is no
 * existing selector precedent to reuse; computed directly from Monaco's own
 * real layout (`glyphMarginLeft: 0`, glyph margin strip immediately left of
 * the line-numbers column — confirmed by reading
 * `@codingame/monaco-vscode-api`'s own `editorOptions.js`/`layoutInfo`
 * computation, not guessed). */
async function clickGlyphMargin(
	page: Page,
	lineText: string,
	button: "left" | "right" = "left",
): Promise<void> {
	const line = page.locator(".monaco-editor .view-line").filter({
		hasText: lineText,
	});
	await expect(line).toHaveCount(1);
	const lineBox = await line.boundingBox();
	if (lineBox === null) {
		throw new Error("Could not locate the target line's bounding box.");
	}
	const margin = page.locator(".monaco-editor .margin-view-overlays").first();
	await expect(margin).toBeVisible();
	const marginBox = await margin.boundingBox();
	if (marginBox === null) {
		throw new Error("Could not locate the glyph margin's bounding box.");
	}
	await page.mouse.click(marginBox.x + 6, lineBox.y + lineBox.height / 2, {
		button,
	});
}

test("Debug requires an explicit multi-root choice and keeps launch plus same-path breakpoints bound to that root", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	await installMultiRootNativeIpcMock(page, "supported");
	await openNativeWorkspaceExplorer(page);
	await executePaletteCommand(
		page,
		"Add Folder to Workspace",
		"Workspaces: Add Folder to Workspace...",
	);

	const openRootMain = async (
		rootLabel: "plain-workspace" | "plain-library",
		marker: "primary-debug" | "secondary-debug",
	): Promise<void> => {
		await page.keyboard.press("ControlOrMeta+P");
		const quickOpen = page.locator(".quick-input-widget");
		await expect(quickOpen).toBeVisible();
		await quickOpen.locator("input").pressSequentially("main.py");
		const row = quickOpen.locator(
			`.quick-input-list .monaco-list-row[aria-label*="${rootLabel}"]`,
		);
		await expect(row).toHaveCount(1);
		await row.click();
		await expect(quickOpen).toBeHidden();
		await expect(
			page.getByRole("code").filter({ hasText: marker }),
		).toBeVisible();
	};
	const startForRoot = async (
		rootLabel: "plain-workspace" | "plain-library",
		adapterCommand: string,
	): Promise<void> => {
		await page.keyboard.press("ControlOrMeta+Shift+P");
		const palette = page.locator(".quick-input-widget");
		await expect(palette).toBeVisible();
		await palette.locator("input").pressSequentially("Start Debugging");
		await palette.getByText("Plain: Start Debugging", { exact: true }).click();
		await expect(palette.locator("input")).toHaveAttribute(
			"placeholder",
			"Select a workspace folder to debug",
		);
		const rootRow = palette
			.locator(".quick-input-list .monaco-list-row")
			.filter({ hasText: rootLabel });
		await expect(rootRow).toHaveCount(1);
		await rootRow.click();
		await expect(palette).toBeHidden();

		const dialog = page.getByRole("dialog");
		await expect(dialog).toContainText(`Run "${adapterCommand}"?`);
		await dialog
			.getByRole("button", { name: "Run Adapter", exact: true })
			.click();
		await expect(dialog).toHaveCount(0);
	};

	await openRootMain("plain-workspace", "primary-debug");
	await clickGlyphMargin(page, "marker = 'primary-debug'");
	await openRootMain("plain-library", "secondary-debug");
	await clickGlyphMargin(page, "print(marker)");
	await openRunAndDebugView(page);
	const launchConfigReads = async (): Promise<TestTauriInvocation[]> =>
		(await terminalCallsFor(page, "workspace_read_file")).filter(
			(call) =>
				(call.args.request as { relativePath?: string }).relativePath ===
				".vscode/launch.json",
		);
	const launchReadsBeforeCancelledStart = (await launchConfigReads()).length;

	// Cancelling the required root picker performs no config read and creates
	// no session; multi-root must never fall back to folders[0].
	await page.keyboard.press("ControlOrMeta+Shift+P");
	const cancelledPicker = page.locator(".quick-input-widget");
	await cancelledPicker.locator("input").pressSequentially("Start Debugging");
	await cancelledPicker
		.getByText("Plain: Start Debugging", { exact: true })
		.click();
	await expect(cancelledPicker.locator("input")).toHaveAttribute(
		"placeholder",
		"Select a workspace folder to debug",
	);
	await page.keyboard.press("Escape");
	await expect(cancelledPicker).toBeHidden();
	expect(await terminalCallsFor(page, "debug_launch")).toEqual([]);
	expect(await launchConfigReads()).toHaveLength(
		launchReadsBeforeCancelledStart,
	);

	await startForRoot("plain-library", "/secondary-debug-adapter");
	await expect
		.poll(async () => (await terminalCallsFor(page, "debug_launch")).length)
		.toBe(1);
	await expect
		.poll(
			async () =>
				(await terminalCallsFor(page, "debug_set_breakpoints")).length,
		)
		.toBe(1);
	const firstSessionId = await currentDebugSessionId(page);
	const launches = await terminalCallsFor(page, "debug_launch");
	expect(launches[0]?.args.request).toMatchObject({
		rootId: nativeSecondaryRootId,
		command: "/secondary-debug-adapter",
		args: ["--root", "secondary"],
		adapterId: "secondary-python",
		arguments: { program: "main.py" },
	});
	let breakpointCalls = await terminalCallsFor(page, "debug_set_breakpoints");
	expect(breakpointCalls[0]?.args.request).toEqual({
		sessionId: firstSessionId,
		rootId: nativeSecondaryRootId,
		path: "main.py",
		breakpoints: [
			{ line: 3, condition: null, logMessage: null, hitCondition: null },
		],
	});
	let launchReads = (await launchConfigReads()).slice(
		launchReadsBeforeCancelledStart,
	);
	expect(
		launchReads.map(
			(call) => (call.args.request as { rootId?: string }).rootId,
		),
	).toEqual([nativeSecondaryRootId]);

	// Editing the same relative path in the other root while the secondary
	// session is live must remain local and must not generate another DAP sync.
	await openRootMain("plain-workspace", "primary-debug");
	await clickGlyphMargin(page, "print(marker)");
	await Promise.resolve();
	await Promise.resolve();
	expect(await terminalCallsFor(page, "debug_set_breakpoints")).toHaveLength(1);

	await executePaletteCommand(page, "Stop Debugging", "Plain: Stop Debugging");
	await startForRoot("plain-workspace", "/primary-debug-adapter");
	await expect
		.poll(async () => (await terminalCallsFor(page, "debug_launch")).length)
		.toBe(2);
	await expect
		.poll(
			async () =>
				(await terminalCallsFor(page, "debug_set_breakpoints")).length,
		)
		.toBe(2);
	const secondSessionId = await currentDebugSessionId(page);
	breakpointCalls = await terminalCallsFor(page, "debug_set_breakpoints");
	expect(breakpointCalls[1]?.args.request).toEqual({
		sessionId: secondSessionId,
		rootId: nativeRootId,
		path: "main.py",
		breakpoints: [
			{ line: 2, condition: null, logMessage: null, hitCondition: null },
			{ line: 3, condition: null, logMessage: null, hitCondition: null },
		],
	});
	launchReads = (await launchConfigReads()).slice(
		launchReadsBeforeCancelledStart,
	);
	expect(
		launchReads.map(
			(call) => (call.args.request as { rootId?: string }).rootId,
		),
	).toEqual([nativeSecondaryRootId, nativeRootId]);
	expect(errors).toEqual([]);
});

// --- `F210` S1 "launch 配置选择器" -------------------------------------------

test("Start Debugging with two launch.json configurations shows a picker and launches the exact selected configuration", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(page, "arrayBuffer", "readonly", {
		"main.py": DEBUG_MAIN_PY,
		".vscode/launch.json": TWO_LAUNCH_CONFIGURATIONS_JSON,
	});

	await openMainPy(page);
	await openRunAndDebugView(page);
	await executePaletteCommand(
		page,
		"Start Debugging",
		"Plain: Start Debugging",
	);

	// A single root means no root picker; the workspace trust gate still
	// fires first, exactly like the single-configuration flow.
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText(
		"Trust this workspace to run a debug adapter?",
	);
	await dialog
		.getByRole("button", { name: "Trust & Continue", exact: true })
		.click();
	await expect(dialog).toHaveCount(0);

	// Two configurations means a real configuration picker appears — never a
	// silent `configurations[0]`.
	const picker = page.locator(".quick-input-widget");
	await expect(picker).toBeVisible();
	await expect(picker.locator("input")).toHaveAttribute(
		"placeholder",
		"Select a launch configuration",
	);
	const rows = picker.locator(".quick-input-list .monaco-list-row");
	await expect(rows).toHaveCount(2);
	await expect(rows.filter({ hasText: "Debug main.py" })).toHaveCount(1);
	const secondRow = rows.filter({ hasText: "Debug server.js" });
	await expect(secondRow).toHaveCount(1);
	await secondRow.click();
	await expect(picker).toBeHidden();

	// The adapter confirmation dialog names the *second* configuration's own
	// command — proof the picker's selection, not the first configuration,
	// drove the rest of this launch.
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText('Run "/usr/bin/node-debug-adapter"?');
	await dialog
		.getByRole("button", { name: "Run Adapter", exact: true })
		.click();
	await expect(dialog).toHaveCount(0);

	await expect
		.poll(async () => (await terminalCallsFor(page, "debug_launch")).length)
		.toBe(1);
	const launches = await terminalCallsFor(page, "debug_launch");
	expect(launches[0]?.args.request).toMatchObject({
		rootId: nativeRootId,
		command: "/usr/bin/node-debug-adapter",
		args: ["--inspect-brk"],
		adapterId: "node",
		arguments: { program: "server.js", stopOnEntry: true },
	});

	expect(pageErrors).toEqual([]);
});

test("cancelling the launch configuration picker starts no session and reads no adapter registry", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(page, "arrayBuffer", "readonly", {
		"main.py": DEBUG_MAIN_PY,
		".vscode/launch.json": TWO_LAUNCH_CONFIGURATIONS_JSON,
	});

	await openMainPy(page);
	await openRunAndDebugView(page);
	await executePaletteCommand(
		page,
		"Start Debugging",
		"Plain: Start Debugging",
	);

	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText(
		"Trust this workspace to run a debug adapter?",
	);
	await dialog
		.getByRole("button", { name: "Trust & Continue", exact: true })
		.click();
	await expect(dialog).toHaveCount(0);

	const picker = page.locator(".quick-input-widget");
	await expect(picker).toBeVisible();
	await expect(picker.locator("input")).toHaveAttribute(
		"placeholder",
		"Select a launch configuration",
	);
	await page.keyboard.press("Escape");
	await expect(picker).toBeHidden();

	// Cancellation is zero further side effects: no confirmation dialog ever
	// appears, no session is created, and — this fixture uses only inline
	// `plainAdapter` overrides, so a real launch never needs it either — no
	// `.plain/debug-adapters.json` registry read happens.
	await expect(page.getByRole("dialog")).toHaveCount(0);
	expect(await terminalCallsFor(page, "debug_launch")).toEqual([]);
	expect(
		(await terminalCallsFor(page, "workspace_read_file")).filter(
			(call) =>
				(call.args.request as { relativePath?: string }).relativePath ===
				".plain/debug-adapters.json",
		),
	).toEqual([]);

	expect(pageErrors).toEqual([]);
});

async function emitDebugTestEvent(
	page: Page,
	sessionId: string,
	event: string,
	body: unknown,
): Promise<void> {
	await page.evaluate(
		({ sessionId, event, body }) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_EMIT_DEBUG_EVENT__(
					sessionId: string,
					event: string,
					body: unknown,
				): void;
			};
			testWindow.__PLAIN_TEST_EMIT_DEBUG_EVENT__(sessionId, event, body);
		},
		{ sessionId, event, body },
	);
}

async function currentDebugSessionId(page: Page): Promise<string> {
	const ids = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_DEBUG_SESSION_IDS__(): readonly string[];
		};
		return testWindow.__PLAIN_TEST_DEBUG_SESSION_IDS__();
	});
	const [sessionId] = ids;
	if (sessionId === undefined) {
		throw new Error("No live debug session exists yet.");
	}
	return sessionId;
}

/** `F100` S4: simulates Rust's own `runInTerminal` handling having already
 * created a real `TerminalService` session — see
 * `__PLAIN_TEST_CREATE_EXTERNAL_TERMINAL_SESSION__`'s own comment in the
 * mock for why this deliberately bypasses `terminal_start`. */
async function createExternalTerminalSessionForTest(
	page: Page,
	sessionId: string,
): Promise<void> {
	await page.evaluate((sessionId) => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_CREATE_EXTERNAL_TERMINAL_SESSION__(
				sessionId: string,
				cols: number,
				rows: number,
			): void;
		};
		testWindow.__PLAIN_TEST_CREATE_EXTERNAL_TERMINAL_SESSION__(
			sessionId,
			80,
			24,
		);
	}, sessionId);
}

test("Run and Debug view reveals Call Stack/Variables/Watch panes with real not-debugging status text", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(page, "arrayBuffer");
	await openNativeWorkspaceExplorer(page);
	await openRunAndDebugView(page);

	await expect(page.locator(".plain-debug-call-stack-view-message")).toHaveText(
		"Not debugging.",
	);
	await expect(page.locator(".plain-debug-variables-view-message")).toHaveText(
		"No frame selected.",
	);
	await expect(page.locator(".plain-debug-watch-view-add-row")).toBeVisible();
	await expect(page.locator(".plain-debug-watch-view-entry")).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

test("places a breakpoint the adapter moves to another line, starts a session through both confirmation gates, and a real stopped event drives the call stack and a paginated variable tree", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	const bigVariables = Array.from({ length: 150 }, (_unused, index) => ({
		name: `item_${index}`,
		value: String(index),
		type: null,
		variablesReference: 0,
		namedVariables: null,
		indexedVariables: null,
	}));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{ "main.py": DEBUG_MAIN_PY, ".vscode/launch.json": DEBUG_LAUNCH_JSON },
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		false,
		{},
		{},
		{
			stackFramesByThread: {
				1: [
					{
						id: 1,
						name: "main",
						line: 6,
						column: 5,
						sourcePath: "main.py",
						sourceName: "main.py",
						instructionPointerReference: null,
					},
					{
						id: 2,
						name: "<module>",
						line: 10,
						column: 1,
						sourcePath: "main.py",
						sourceName: "main.py",
						instructionPointerReference: null,
					},
				],
			},
			scopesByFrame: {
				1: [
					{
						name: "Locals",
						variablesReference: 100,
						namedVariables: 2,
						indexedVariables: null,
						expensive: false,
					},
				],
			},
			variablesByReference: {
				100: [
					{
						name: "a",
						value: "3",
						type: "int",
						variablesReference: 0,
						namedVariables: null,
						indexedVariables: null,
					},
					{
						name: "big",
						value: "list[150]",
						type: null,
						variablesReference: 300,
						namedVariables: null,
						indexedVariables: 150,
					},
				],
				300: bigVariables,
			},
			// The real adapter moves the requested breakpoint (line 6) to
			// line 105 — this feature's own acceptance criteria call this
			// scenario out by name.
			breakpointOutcomes: {
				"main.py": { 6: { line: 105 } },
			},
		},
	);

	await openMainPy(page);
	// Meaningful interaction 1: left-click the glyph margin places a
	// breakpoint, rendered immediately (before any session exists) as
	// "unverified" — there is no adapter yet to have verified anything.
	await clickGlyphMargin(page, "total = add(3, 4)");
	const glyph = page.locator(".plain-debug-breakpoint-glyph");
	await expect(glyph).toHaveCount(1);
	await expect(glyph).toHaveClass(/plain-debug-breakpoint-glyph-unverified/);

	await openRunAndDebugView(page);
	await executePaletteCommand(
		page,
		"Start Debugging",
		"Plain: Start Debugging",
	);

	// A single locator, tracked through both dialogs in turn — the adapter
	// confirmation dialog can appear in the very same tick the trust dialog
	// closes, so asserting an intermediate "zero dialogs visible" state
	// between them would be racy; waiting for the *content* to change to
	// each step's own expected text is what is actually deterministic here.
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText(
		"Trust this workspace to run a debug adapter?",
	);
	await dialog
		.getByRole("button", { name: "Trust & Continue", exact: true })
		.click();
	// `F210` S1 regression evidence: `DEBUG_LAUNCH_JSON` has exactly one
	// configuration, so no configuration picker ever appears between the
	// trust dialog closing and the adapter confirmation dialog appearing —
	// the sole configuration is used automatically, mirroring
	// `selectPlainDebugRoot`'s identical single-root auto-select.
	await expect(
		page.locator(
			'.quick-input-widget input[placeholder="Select a launch configuration"]',
		),
	).toHaveCount(0);
	await expect(dialog).toContainText('Run "/usr/bin/python3"?');
	await dialog
		.getByRole("button", { name: "Run Adapter", exact: true })
		.click();
	await expect(dialog).toHaveCount(0);

	await expect
		.poll(async () => (await terminalCallsFor(page, "debug_launch")).length)
		.toBe(1);
	expect(
		(await terminalCallsFor(page, "debug_launch"))[0]?.args.request,
	).toMatchObject({ rootId: nativeRootId });
	const sessionId = await currentDebugSessionId(page);

	// The freshly-placed breakpoint is synced immediately once the session
	// is ready — real data flow, not a canned response: the request carries
	// this exact breakpoint, and the adapter's real (scripted) "moved to
	// line 105" verdict is what flips the glyph's rendered class.
	await expect
		.poll(
			async () =>
				(await terminalCallsFor(page, "debug_set_breakpoints")).length,
		)
		.toBe(1);
	const setBreakpointsCall = (
		await terminalCallsFor(page, "debug_set_breakpoints")
	)[0]!;
	expect(setBreakpointsCall.args.request).toEqual({
		sessionId,
		rootId: nativeRootId,
		path: "main.py",
		breakpoints: [
			{ line: 6, condition: null, logMessage: null, hitCondition: null },
		],
	});
	await expect(glyph).toHaveClass(/plain-debug-breakpoint-glyph-verified/);
	await expect(glyph).not.toHaveClass(
		/plain-debug-breakpoint-glyph-unverified/,
	);

	// Meaningful interaction 2: a real `stopped` event (simulating the
	// adapter hitting the breakpoint) drives a real `debug_stack_trace`
	// fetch, rendering the two real, distinctly-named seeded frames.
	await emitDebugTestEvent(page, sessionId, "stopped", {
		threadId: 1,
		reason: "breakpoint",
	});

	const frameButtons = page.locator(
		".plain-debug-call-stack-view-frame-button",
	);
	await expect(frameButtons).toHaveText([
		"main (main.py:6)",
		"<module> (main.py:10)",
	]);
	const frameItems = page.locator(".plain-debug-call-stack-view-frame");
	await expect(frameItems.nth(0)).toHaveClass(
		/plain-debug-call-stack-view-frame-selected/,
	);
	await expect(frameItems.nth(1)).not.toHaveClass(
		/plain-debug-call-stack-view-frame-selected/,
	);

	// The top frame auto-selects, which alone (no click needed) drives the
	// Variables view to fetch real scopes for it.
	const tree = page.locator(".plain-debug-variables-view-tree");
	const localsNode = tree
		.locator(":scope > .plain-debug-variables-node")
		.filter({ hasText: "Locals" });
	await expect(localsNode).toHaveCount(1);

	// Meaningful interaction 3: expanding "Locals" issues a real
	// `debug_variables` call and renders the real leaf/nested entries.
	await localsNode
		.locator(
			":scope > .plain-debug-variables-row > .plain-debug-variables-toggle",
		)
		.click();
	const localsChildren = localsNode.locator(
		":scope > .plain-debug-variables-children > .plain-debug-variables-node",
	);
	await expect(localsChildren).toHaveCount(2);
	await expect(localsChildren.filter({ hasText: "a: 3 (int)" })).toHaveCount(1);
	const bigNode = localsChildren.filter({ hasText: "big: list[150]" });
	await expect(bigNode).toHaveCount(1);

	// Meaningful interaction 4: expanding the large "big" collection issues
	// a real `debug_variables` call with `start`/`count` — this is the
	// lazy-expansion-and-pagination contract itself, not a client-side
	// slice of an already-fully-fetched array.
	await bigNode
		.locator(
			":scope > .plain-debug-variables-row > .plain-debug-variables-toggle",
		)
		.click();
	const bigChildren = bigNode.locator(
		":scope > .plain-debug-variables-children > .plain-debug-variables-node",
	);
	await expect(bigChildren).toHaveCount(100);
	await expect(bigChildren.first()).toHaveText("item_0: 0");
	await expect(bigChildren.last()).toHaveText("item_99: 99");
	// The button lives inside its own `<li>` wrapper (a grandchild of
	// `.plain-debug-variables-children`, not a direct child) — a descendant
	// combinator for the last segment, not `>`.
	const loadMoreButton = bigNode.locator(
		":scope > .plain-debug-variables-children .plain-debug-variables-load-more",
	);
	await expect(loadMoreButton).toHaveText("Load 50 more…");

	// Meaningful interaction 5: "Load more" fetches the real next page
	// (`start: 100, count: 100`), proving real pagination rather than a
	// single oversized fetch.
	await loadMoreButton.click();
	await expect(bigChildren).toHaveCount(150);
	await expect(bigChildren.last()).toHaveText("item_149: 149");
	await expect(loadMoreButton).toHaveCount(0);
	const variablesCalls = await terminalCallsFor(page, "debug_variables");
	const bigReferenceCalls = variablesCalls.filter(
		(call) =>
			(call.args.request as { variablesReference?: number })
				.variablesReference === 300,
	);
	expect(bigReferenceCalls.map((call) => call.args.request)).toEqual([
		{
			sessionId,
			variablesReference: 300,
			start: 0,
			count: 100,
			filter: null,
		},
		{
			sessionId,
			variablesReference: 300,
			start: 100,
			count: 100,
			filter: null,
		},
	]);

	// Meaningful interaction 6: selecting a different frame (frame 2, which
	// has no seeded scopes) really refetches — the Variables view goes back
	// to its empty-state message, proving the refresh is driven by real
	// frame-selection state, not a one-shot fetch that never updates again.
	await frameButtons.nth(1).click();
	await expect(page.locator(".plain-debug-variables-view-message")).toHaveText(
		"No variables.",
	);

	expect(pageErrors).toEqual([]);
});

test("Watch view evaluates added expressions via debug_evaluate under context watch", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{ "main.py": DEBUG_MAIN_PY, ".vscode/launch.json": DEBUG_LAUNCH_JSON },
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{},
		{},
		{
			evaluateByExpression: {
				"a + b": {
					result: "7",
					type: "int",
					variablesReference: 0,
					namedVariables: null,
					indexedVariables: null,
				},
			},
		},
	);
	await openNativeWorkspaceExplorer(page);
	await openRunAndDebugView(page);
	await executePaletteCommand(
		page,
		"Start Debugging",
		"Plain: Start Debugging",
	);
	const adapterDialog = page.getByRole("dialog");
	await expect(adapterDialog).toBeVisible();
	await adapterDialog
		.getByRole("button", { name: "Run Adapter", exact: true })
		.click();
	await expect(adapterDialog).toHaveCount(0);
	const sessionId = await currentDebugSessionId(page);

	// Meaningful interaction 1: adding an expression with a scripted fixture
	// evaluates to its real result, via a real `debug_evaluate` call under
	// `context: "watch"`.
	const input = page.locator(".plain-debug-watch-view-input");
	await input.fill("a + b");
	await page.locator(".plain-debug-watch-view-add-button").click();
	const entry = page
		.locator(".plain-debug-watch-view-entry")
		.filter({ hasText: "a + b" });
	await expect(entry.locator(".plain-debug-watch-view-value")).toHaveText(
		"7 (int)",
	);
	const evalCalls = await terminalCallsFor(page, "debug_evaluate");
	expect(evalCalls).toHaveLength(1);
	expect(evalCalls[0]!.args.request).toEqual({
		sessionId,
		expression: "a + b",
		frameId: null,
		context: "watch",
	});

	// Meaningful interaction 2: an expression with no scripted fixture falls
	// back to the mock's real "echo the expression back" default — proving
	// this is a genuine round trip, not a hardcoded UI string.
	await input.fill("unscripted_expr");
	await page.locator(".plain-debug-watch-view-add-button").click();
	const entry2 = page
		.locator(".plain-debug-watch-view-entry")
		.filter({ hasText: "unscripted_expr" });
	await expect(entry2.locator(".plain-debug-watch-view-value")).toHaveText(
		"unscripted_expr",
	);

	// Meaningful interaction 3: removing an expression removes its row.
	await entry.getByRole("button", { name: "Remove", exact: true }).click();
	await expect(entry).toHaveCount(0);
	await expect(entry2).toHaveCount(1);

	expect(pageErrors).toEqual([]);
});

// `F210` S2 — nested Watch results reuse the exact same
// `DebugVariablesTree`/`renderVariablesTreeNode` engine the Variables tree
// test above exercises: real expand/pagination against the live adapter for
// a watch expression's own `variablesReference`, and expand/collapse state
// that survives a re-evaluate.
test("Watch results with a variablesReference expand through the shared variables tree, page past 100 children, and keep expanded paths across a re-evaluate", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	const bigVariables = Array.from({ length: 150 }, (_unused, index) => ({
		name: `item_${index}`,
		value: String(index),
		type: null,
		variablesReference: 0,
		namedVariables: null,
		indexedVariables: null,
	}));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{ "main.py": DEBUG_MAIN_PY, ".vscode/launch.json": DEBUG_LAUNCH_JSON },
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{},
		{},
		{
			stackFramesByThread: {
				1: [
					{
						id: 1,
						name: "main",
						line: 6,
						column: 5,
						sourcePath: "main.py",
						sourceName: "main.py",
						instructionPointerReference: null,
					},
				],
			},
			evaluateByExpression: {
				obj: {
					result: "<Point>",
					type: "Point",
					variablesReference: 400,
					namedVariables: 2,
					indexedVariables: null,
				},
				big: {
					result: "<Big>",
					type: null,
					variablesReference: 500,
					namedVariables: null,
					indexedVariables: 150,
				},
			},
			variablesByReference: {
				400: [
					{
						name: "x",
						value: "1",
						type: "int",
						variablesReference: 0,
						namedVariables: null,
						indexedVariables: null,
					},
					{
						name: "nested",
						value: "<Nested>",
						type: "Nested",
						variablesReference: 401,
						namedVariables: 1,
						indexedVariables: null,
					},
				],
				401: [
					{
						name: "y",
						value: "2",
						type: "int",
						variablesReference: 0,
						namedVariables: null,
						indexedVariables: null,
					},
				],
				500: bigVariables,
			},
		},
	);
	await openNativeWorkspaceExplorer(page);
	await openRunAndDebugView(page);
	await executePaletteCommand(
		page,
		"Start Debugging",
		"Plain: Start Debugging",
	);
	const adapterDialog = page.getByRole("dialog");
	await expect(adapterDialog).toBeVisible();
	await adapterDialog
		.getByRole("button", { name: "Run Adapter", exact: true })
		.click();
	await expect(adapterDialog).toHaveCount(0);
	const sessionId = await currentDebugSessionId(page);

	// A real `stopped` event drives the call stack, whose sole frame
	// auto-selects — this is what feeds the Watch view's own `frameId`, same
	// as the Variables tree test above.
	await emitDebugTestEvent(page, sessionId, "stopped", {
		threadId: 1,
		reason: "breakpoint",
	});
	await expect(
		page.locator(".plain-debug-call-stack-view-frame-button"),
	).toHaveText(["main (main.py:6)"]);

	// Both expressions are added up front, before either is ever expanded:
	// `#addExpression` re-evaluates *every* existing entry (not just the new
	// one), so expanding "obj" before "big" exists would let "big"'s own
	// `#addExpression` call silently re-evaluate "obj" a second time —
	// muddying the exact `debug_variables` call counts the assertions below
	// depend on. Adding both while both are still collapsed sidesteps that
	// entirely (a collapsed entry's re-evaluate issues no `debug_variables`
	// call at all).
	const input = page.locator(".plain-debug-watch-view-input");
	const addButton = page.locator(".plain-debug-watch-view-add-button");
	await input.fill("obj");
	await addButton.click();
	await input.fill("big");
	await addButton.click();
	const objEntry = page
		.locator(".plain-debug-watch-view-entry")
		.filter({ hasText: "obj" });
	const bigEntry = page
		.locator(".plain-debug-watch-view-entry")
		.filter({ hasText: "big" });
	await expect(objEntry).toHaveCount(1);
	await expect(bigEntry).toHaveCount(1);

	// Meaningful interaction 1: a watch result whose own `variablesReference`
	// is non-zero renders through the shared tree — collapsed by default,
	// with the composed `result (type)` text as the root node's own label
	// (not a flat, non-interactive span, which only the
	// `variablesReference === 0` case above still uses).
	const objRoot = objEntry.locator(".plain-debug-variables-node").first();
	await expect(objRoot).toHaveCount(1);
	await expect(objEntry.locator(".plain-debug-watch-view-value")).toHaveCount(
		0,
	);
	const objToggle = objRoot.locator(
		":scope > .plain-debug-variables-row > .plain-debug-variables-toggle",
	);
	await expect(objToggle).toHaveText("▸");
	await expect(
		objRoot.locator(":scope > .plain-debug-variables-row"),
	).toHaveText("▸<Point> (Point)");

	// Meaningful interaction 2: expanding the root issues a real
	// `debug_variables` call for its own `variablesReference` and renders
	// the real children — one level deep.
	await objToggle.click();
	const objChildren = objRoot.locator(
		":scope > .plain-debug-variables-children > .plain-debug-variables-node",
	);
	await expect(objChildren).toHaveCount(2);
	await expect(objChildren.filter({ hasText: "x: 1 (int)" })).toHaveCount(1);
	const nestedNode = objChildren.filter({
		hasText: "nested: <Nested> (Nested)",
	});
	await expect(nestedNode).toHaveCount(1);

	// Meaningful interaction 3: expanding "nested" goes two levels deep from
	// the watch expression's own root — proving this is real recursive
	// expansion, not a single hard-coded level.
	const nestedToggle = nestedNode.locator(
		":scope > .plain-debug-variables-row > .plain-debug-variables-toggle",
	);
	await nestedToggle.click();
	const nestedChildren = nestedNode.locator(
		":scope > .plain-debug-variables-children > .plain-debug-variables-node",
	);
	await expect(nestedChildren).toHaveText(["y: 2 (int)"]);

	const variablesCallsAfterExpand = await terminalCallsFor(
		page,
		"debug_variables",
	);
	expect(
		variablesCallsAfterExpand
			.filter(
				(call) =>
					(call.args.request as { variablesReference?: number })
						.variablesReference === 400,
			)
			.map((call) => call.args.request),
	).toEqual([
		{ sessionId, variablesReference: 400, start: 0, count: 100, filter: null },
	]);
	expect(
		variablesCallsAfterExpand
			.filter(
				(call) =>
					(call.args.request as { variablesReference?: number })
						.variablesReference === 401,
			)
			.map((call) => call.args.request),
	).toEqual([
		{ sessionId, variablesReference: 401, start: 0, count: 100, filter: null },
	]);

	// Meaningful interaction 4: "big"'s result has more than 100 children —
	// real pagination against the live adapter, same "Load N more"
	// affordance the Variables tree uses.
	const bigRoot = bigEntry.locator(".plain-debug-variables-node").first();
	await expect(bigRoot).toHaveCount(1);
	await bigRoot
		.locator(
			":scope > .plain-debug-variables-row > .plain-debug-variables-toggle",
		)
		.click();
	const bigChildren = bigRoot.locator(
		":scope > .plain-debug-variables-children > .plain-debug-variables-node",
	);
	await expect(bigChildren).toHaveCount(100);
	const bigLoadMoreButton = bigRoot.locator(
		":scope > .plain-debug-variables-children .plain-debug-variables-load-more",
	);
	await expect(bigLoadMoreButton).toHaveText("Load 50 more…");
	await bigLoadMoreButton.click();
	await expect(bigChildren).toHaveCount(150);
	await expect(bigLoadMoreButton).toHaveCount(0);
	const bigReferenceCalls = (
		await terminalCallsFor(page, "debug_variables")
	).filter(
		(call) =>
			(call.args.request as { variablesReference?: number })
				.variablesReference === 500,
	);
	expect(bigReferenceCalls.map((call) => call.args.request)).toEqual([
		{ sessionId, variablesReference: 500, start: 0, count: 100, filter: null },
		{
			sessionId,
			variablesReference: 500,
			start: 100,
			count: 100,
			filter: null,
		},
	]);

	// Meaningful interaction 5: a real re-evaluate (a second `stopped` event,
	// the same trigger a real "hit the breakpoint again" produces) keeps
	// "obj"'s own two-level expansion — real fresh `debug_variables` calls
	// for both references fire again (proving this is a genuine re-fetch,
	// not stale leftover DOM), and the same children render without the user
	// re-clicking anything.
	await emitDebugTestEvent(page, sessionId, "stopped", {
		threadId: 1,
		reason: "breakpoint",
	});
	await expect(objChildren).toHaveCount(2);
	await expect(objChildren.filter({ hasText: "x: 1 (int)" })).toHaveCount(1);
	await expect(nestedNode).toHaveCount(1);
	await expect(nestedChildren).toHaveText(["y: 2 (int)"]);
	const variablesCallsAfterReevaluate = await terminalCallsFor(
		page,
		"debug_variables",
	);
	expect(
		variablesCallsAfterReevaluate.filter(
			(call) =>
				(call.args.request as { variablesReference?: number })
					.variablesReference === 400,
		),
	).toHaveLength(2);
	expect(
		variablesCallsAfterReevaluate.filter(
			(call) =>
				(call.args.request as { variablesReference?: number })
					.variablesReference === 401,
		),
	).toHaveLength(2);

	expect(pageErrors).toEqual([]);
});

test("breakpoint popup disables condition/log-point/hit-count inputs when the adapter's capabilities do not advertise support, and a rejected breakpoint renders distinctly", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{ "main.py": DEBUG_MAIN_PY, ".vscode/launch.json": DEBUG_LAUNCH_JSON },
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{},
		{},
		{
			capabilities: {},
			breakpointOutcomes: {
				"main.py": { 6: { verified: false, message: "No code at this line." } },
			},
		},
	);
	await openMainPy(page);
	await clickGlyphMargin(page, "total = add(3, 4)");
	const glyph = page.locator(".plain-debug-breakpoint-glyph");
	await expect(glyph).toHaveClass(/plain-debug-breakpoint-glyph-unverified/);

	await executePaletteCommand(
		page,
		"Start Debugging",
		"Plain: Start Debugging",
	);
	const adapterDialog = page.getByRole("dialog");
	await expect(adapterDialog).toBeVisible();
	await adapterDialog
		.getByRole("button", { name: "Run Adapter", exact: true })
		.click();
	await expect(adapterDialog).toHaveCount(0);

	await expect
		.poll(
			async () =>
				(await terminalCallsFor(page, "debug_set_breakpoints")).length,
		)
		.toBe(1);
	// The adapter rejected this breakpoint outright — a different rendered
	// state than "verified" or "unverified" (not yet asked).
	await expect(glyph).toHaveClass(/plain-debug-breakpoint-glyph-rejected/);

	// Meaningful interaction: right-click opens the popup; both inputs are
	// genuinely disabled (not merely styled) with an explanatory
	// placeholder — the "capability not advertised" half of this feature's
	// required control group (see the next test for the "supported" half).
	await clickGlyphMargin(page, "total = add(3, 4)", "right");
	const popup = page.locator(".plain-debug-breakpoint-popup");
	await expect(popup).toBeVisible();
	const conditionInput = popup.locator(
		".plain-debug-breakpoint-popup-condition",
	);
	const logInput = popup.locator(".plain-debug-breakpoint-popup-log-message");
	const hitConditionInput = popup.locator(
		".plain-debug-breakpoint-popup-hit-condition",
	);
	await expect(conditionInput).toBeDisabled();
	await expect(logInput).toBeDisabled();
	await expect(hitConditionInput).toBeDisabled();
	await expect(conditionInput).toHaveAttribute(
		"placeholder",
		"Not supported by this adapter",
	);
	await expect(logInput).toHaveAttribute(
		"placeholder",
		"Not supported by this adapter",
	);
	await expect(hitConditionInput).toHaveAttribute(
		"placeholder",
		"Not supported by this adapter",
	);

	expect(pageErrors).toEqual([]);
});

test("breakpoint popup enables condition/log-point/hit-count inputs when the adapter advertises support, and saving re-syncs the live session", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{ "main.py": DEBUG_MAIN_PY, ".vscode/launch.json": DEBUG_LAUNCH_JSON },
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{},
		{},
		{
			capabilities: {
				supportsConditionalBreakpoints: true,
				supportsLogPoints: true,
				supportsHitConditionalBreakpoints: true,
			},
		},
	);
	await openMainPy(page);
	await clickGlyphMargin(page, "total = add(3, 4)");

	await executePaletteCommand(
		page,
		"Start Debugging",
		"Plain: Start Debugging",
	);
	const adapterDialog = page.getByRole("dialog");
	await expect(adapterDialog).toBeVisible();
	await adapterDialog
		.getByRole("button", { name: "Run Adapter", exact: true })
		.click();
	await expect(adapterDialog).toHaveCount(0);
	const sessionId = await currentDebugSessionId(page);

	await expect
		.poll(
			async () =>
				(await terminalCallsFor(page, "debug_set_breakpoints")).length,
		)
		.toBe(1);

	// Control-group counterpart to the previous test: same feature, same
	// popup, but the live session's capabilities now really advertise
	// support — the exact three inputs the previous test proved disabled are
	// now genuinely enabled.
	await clickGlyphMargin(page, "total = add(3, 4)", "right");
	const popup = page.locator(".plain-debug-breakpoint-popup");
	await expect(popup).toBeVisible();
	const conditionInput = popup.locator(
		".plain-debug-breakpoint-popup-condition",
	);
	const logInput = popup.locator(".plain-debug-breakpoint-popup-log-message");
	const hitConditionInput = popup.locator(
		".plain-debug-breakpoint-popup-hit-condition",
	);
	await expect(conditionInput).toBeEnabled();
	await expect(logInput).toBeEnabled();
	await expect(hitConditionInput).toBeEnabled();

	// Meaningful interaction: typing a condition and a hit-count expression
	// and saving re-syncs the breakpoint with the live session — a real
	// second `debug_set_breakpoints` call carrying the real text, not just a
	// local UI update. Leading/trailing whitespace in the hit-count input is
	// trimmed before it is ever sent (Plain never parses the expression
	// itself, but it does not forward incidental whitespace either).
	await conditionInput.fill("total > 5");
	await hitConditionInput.fill("  >= 3  ");
	await popup.locator(".plain-debug-breakpoint-popup-save").click();
	await expect(popup).toHaveCount(0);

	await expect
		.poll(
			async () =>
				(await terminalCallsFor(page, "debug_set_breakpoints")).length,
		)
		.toBe(2);
	const calls = await terminalCallsFor(page, "debug_set_breakpoints");
	expect(calls[1]!.args.request).toEqual({
		sessionId,
		rootId: nativeRootId,
		path: "main.py",
		breakpoints: [
			{
				line: 6,
				condition: "total > 5",
				logMessage: null,
				hitCondition: ">= 3",
			},
		],
	});

	expect(pageErrors).toEqual([]);
});

test("editing then clearing a breakpoint's hit-count re-syncs the live session each time, and its line stays the stable identity", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{ "main.py": DEBUG_MAIN_PY, ".vscode/launch.json": DEBUG_LAUNCH_JSON },
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{},
		{},
		{
			capabilities: { supportsHitConditionalBreakpoints: true },
		},
	);
	await openMainPy(page);
	await clickGlyphMargin(page, "total = add(3, 4)");

	await executePaletteCommand(
		page,
		"Start Debugging",
		"Plain: Start Debugging",
	);
	const adapterDialog = page.getByRole("dialog");
	await expect(adapterDialog).toBeVisible();
	await adapterDialog
		.getByRole("button", { name: "Run Adapter", exact: true })
		.click();
	await expect(adapterDialog).toHaveCount(0);
	const sessionId = await currentDebugSessionId(page);

	await expect
		.poll(
			async () =>
				(await terminalCallsFor(page, "debug_set_breakpoints")).length,
		)
		.toBe(1);

	// First edit: set a hit-count expression.
	await clickGlyphMargin(page, "total = add(3, 4)", "right");
	let popup = page.locator(".plain-debug-breakpoint-popup");
	await expect(popup).toBeVisible();
	await popup.locator(".plain-debug-breakpoint-popup-hit-condition").fill("5");
	await popup.locator(".plain-debug-breakpoint-popup-save").click();
	await expect(popup).toHaveCount(0);

	await expect
		.poll(
			async () =>
				(await terminalCallsFor(page, "debug_set_breakpoints")).length,
		)
		.toBe(2);
	let calls = await terminalCallsFor(page, "debug_set_breakpoints");
	expect(calls[1]!.args.request).toEqual({
		sessionId,
		rootId: nativeRootId,
		path: "main.py",
		breakpoints: [
			{ line: 6, condition: null, logMessage: null, hitCondition: "5" },
		],
	});

	// Second edit: re-opening the popup prefills the previously saved value —
	// the same line is still the breakpoint's identity, not a new one.
	await clickGlyphMargin(page, "total = add(3, 4)", "right");
	popup = page.locator(".plain-debug-breakpoint-popup");
	await expect(popup).toBeVisible();
	const hitConditionInput = popup.locator(
		".plain-debug-breakpoint-popup-hit-condition",
	);
	await expect(hitConditionInput).toHaveValue("5");
	await hitConditionInput.fill("");
	await popup.locator(".plain-debug-breakpoint-popup-save").click();
	await expect(popup).toHaveCount(0);

	await expect
		.poll(
			async () =>
				(await terminalCallsFor(page, "debug_set_breakpoints")).length,
		)
		.toBe(3);
	calls = await terminalCallsFor(page, "debug_set_breakpoints");
	expect(calls[2]!.args.request).toEqual({
		sessionId,
		rootId: nativeRootId,
		path: "main.py",
		breakpoints: [
			{ line: 6, condition: null, logMessage: null, hitCondition: null },
		],
	});

	expect(pageErrors).toEqual([]);
});

// --- `F100` S4 "步进控制 + Debug Console/REPL + runInTerminal" --------------

async function launchDebugSessionThroughBothDialogs(
	page: Page,
): Promise<string> {
	await openMainPy(page);
	await openRunAndDebugView(page);
	await executePaletteCommand(
		page,
		"Start Debugging",
		"Plain: Start Debugging",
	);
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText(
		"Trust this workspace to run a debug adapter?",
	);
	await dialog
		.getByRole("button", { name: "Trust & Continue", exact: true })
		.click();
	await expect(dialog).toContainText('Run "/usr/bin/python3"?');
	await dialog
		.getByRole("button", { name: "Run Adapter", exact: true })
		.click();
	await expect(dialog).toHaveCount(0);
	await expect
		.poll(async () => (await terminalCallsFor(page, "debug_launch")).length)
		.toBe(1);
	return currentDebugSessionId(page);
}

test("step control toolbar enables Continue/Step buttons only while stopped and Pause only while running, and sends the exact DAP command for each", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(page, "arrayBuffer", "readonly", {
		"main.py": DEBUG_MAIN_PY,
		".vscode/launch.json": DEBUG_LAUNCH_JSON,
	});

	const sessionId = await launchDebugSessionThroughBothDialogs(page);

	const continueButton = page.locator(".plain-debug-call-stack-view-continue");
	const pauseButton = page.locator(".plain-debug-call-stack-view-pause");
	const nextButton = page.locator(".plain-debug-call-stack-view-next");
	const stepInButton = page.locator(".plain-debug-call-stack-view-step-in");
	const stepOutButton = page.locator(".plain-debug-call-stack-view-step-out");

	// Before any `stopped` event has ever fired: nothing is enabled (no known
	// thread at all, let alone a stopped one).
	await expect(continueButton).toBeDisabled();
	await expect(nextButton).toBeDisabled();
	await expect(stepInButton).toBeDisabled();
	await expect(stepOutButton).toBeDisabled();
	await expect(pauseButton).toBeDisabled();

	// A real `stopped` event enables Continue/Step Over/Step Into/Step Out
	// (there is now a concrete stopped thread to resume/step from) but not
	// Pause (the debuggee is not running).
	await emitDebugTestEvent(page, sessionId, "stopped", {
		threadId: 1,
		reason: "breakpoint",
	});
	await expect(continueButton).toBeEnabled();
	await expect(nextButton).toBeEnabled();
	await expect(stepInButton).toBeEnabled();
	await expect(stepOutButton).toBeEnabled();
	await expect(pauseButton).toBeDisabled();

	// Meaningful interaction 1: Step Over really sends `debug_next` scoped to
	// the exact stopped thread id.
	await nextButton.click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "debug_next")).length)
		.toBe(1);
	expect((await terminalCallsFor(page, "debug_next"))[0]!.args.request).toEqual(
		{ sessionId, threadId: 1 },
	);

	// Meaningful interaction 2: Step Into/Step Out each send their own,
	// distinct real request too — not just `next`.
	// `F210` S4: the existing Step Into button's behavior is entirely
	// unchanged — it still never selects a target, so `targetId` is `null`
	// even though the wire request now always carries the key.
	await stepInButton.click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "debug_step_in")).length)
		.toBe(1);
	expect(
		(await terminalCallsFor(page, "debug_step_in"))[0]!.args.request,
	).toEqual({ sessionId, threadId: 1, targetId: null });
	await stepOutButton.click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "debug_step_out")).length)
		.toBe(1);
	expect(
		(await terminalCallsFor(page, "debug_step_out"))[0]!.args.request,
	).toEqual({ sessionId, threadId: 1 });

	// Meaningful interaction 3: Continue really sends `debug_continue`.
	await continueButton.click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "debug_continue")).length)
		.toBe(1);
	expect(
		(await terminalCallsFor(page, "debug_continue"))[0]!.args.request,
	).toEqual({ sessionId, threadId: 1 });

	// A real `continued` event flips the toolbar: steps disable, Pause
	// enables — targeting `lastKnownThreadId`, which survives the reset to
	// `stoppedThreadId: null` (this is the whole reason that field exists
	// separately from `stoppedThreadId`).
	await emitDebugTestEvent(page, sessionId, "continued", null);
	await expect(continueButton).toBeDisabled();
	await expect(nextButton).toBeDisabled();
	await expect(stepInButton).toBeDisabled();
	await expect(stepOutButton).toBeDisabled();
	await expect(pauseButton).toBeEnabled();

	// Meaningful interaction 4: Pause really sends `debug_pause` scoped to the
	// last known thread id (1), even though the debuggee is now running (no
	// `stoppedThreadId`).
	await pauseButton.click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "debug_pause")).length)
		.toBe(1);
	expect(
		(await terminalCallsFor(page, "debug_pause"))[0]!.args.request,
	).toEqual({ sessionId, threadId: 1 });

	expect(pageErrors).toEqual([]);
});

test("a step request the adapter rejects because the session is not really stopped surfaces the real rejection message without an unhandled error", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{ "main.py": DEBUG_MAIN_PY, ".vscode/launch.json": DEBUG_LAUNCH_JSON },
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		false,
		{},
		{},
		{ stepRequestsRejectedForTest: true },
	);

	const sessionId = await launchDebugSessionThroughBothDialogs(page);
	await emitDebugTestEvent(page, sessionId, "stopped", {
		threadId: 1,
		reason: "breakpoint",
	});

	const nextButton = page.locator(".plain-debug-call-stack-view-next");
	await expect(nextButton).toBeEnabled();
	await nextButton.click();

	await expect
		.poll(async () => (await terminalCallsFor(page, "debug_next")).length)
		.toBe(1);
	await expect(
		page.locator(".plain-debug-call-stack-view-message"),
	).toContainText("not stopped");

	// The real adapter rejection is surfaced as inline status text, never an
	// unhandled promise rejection reaching the page (F090 S0's own recorded
	// lesson about exactly this class of bug).
	expect(pageErrors).toEqual([]);
});

test("Debug Console evaluates an expression via debug_evaluate under context repl, renders stdout/stderr output, and never renders telemetry", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{ "main.py": DEBUG_MAIN_PY, ".vscode/launch.json": DEBUG_LAUNCH_JSON },
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		false,
		{},
		{},
		{
			evaluateByExpression: {
				"1 + 1": {
					result: "2",
					type: "int",
					variablesReference: 0,
					namedVariables: null,
					indexedVariables: null,
				},
			},
		},
	);

	const sessionId = await launchDebugSessionThroughBothDialogs(page);

	await executePaletteCommand(page, "Debug Console", "Plain: Debug Console");
	const input = page.locator(".plain-debug-console-view-input");
	await expect(input).toBeVisible();

	// Meaningful interaction 1: submitting an expression really calls
	// `debug_evaluate` under `context: "repl"` (the first real `"repl"`
	// caller in this codebase — S3 only ever exercised `"watch"`), and the
	// real scripted result appears in the console.
	await input.fill("1 + 1");
	await input.press("Enter");
	await expect
		.poll(async () => (await terminalCallsFor(page, "debug_evaluate")).length)
		.toBe(1);
	expect(
		(await terminalCallsFor(page, "debug_evaluate"))[0]!.args.request,
	).toEqual({ sessionId, expression: "1 + 1", frameId: null, context: "repl" });
	const lines = page.locator(".plain-debug-console-view-line");
	await expect(lines).toHaveText(["> 1 + 1", "2 (int)"]);

	// Meaningful interaction 2: real `output` events append with
	// category-specific rendering; `telemetry` never renders at all — not
	// merely hidden by CSS, the text never reaches the DOM.
	await emitDebugTestEvent(page, sessionId, "output", {
		category: "stdout",
		output: "hello stdout",
	});
	await emitDebugTestEvent(page, sessionId, "output", {
		category: "stderr",
		output: "hello stderr",
	});
	await emitDebugTestEvent(page, sessionId, "output", {
		category: "telemetry",
		output: "should never appear",
	});

	await expect(lines).toHaveCount(4);
	await expect(
		page.locator(".plain-debug-console-view-line-stdout"),
	).toHaveText("hello stdout");
	await expect(
		page.locator(".plain-debug-console-view-line-stderr"),
	).toHaveText("hello stderr");
	await expect(page.getByText("should never appear")).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

test("a real runInTerminal reverse request surfaces as a visible, distinctly-titled terminal tab with real data flow that the user can kill through the ordinary terminal_kill path", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(page, "arrayBuffer", "readonly", {
		"main.py": DEBUG_MAIN_PY,
		".vscode/launch.json": DEBUG_LAUNCH_JSON,
	});

	const sessionId = await launchDebugSessionThroughBothDialogs(page);

	// Simulates Rust's own `TerminalService::start_program` having already
	// created a real terminal session (via `handle_run_in_terminal_reverse_request`)
	// — this test never calls `terminal_start` at all, matching the real
	// production flow's own "attach, never spawn a second session" contract.
	const terminalSessionId = "00000000-0000-4000-8000-000000000999";
	await createExternalTerminalSessionForTest(page, terminalSessionId);
	await emitDebugTestEvent(page, sessionId, "plain/runInTerminal", {
		terminalSessionId,
		title: "/usr/bin/python3 main.py",
		processId: 4242,
	});

	// Meaningful assertion 1: the terminal panel is forcibly revealed (the
	// "可见性兜底" this feature's own design rests on in place of a second
	// confirmation dialog) and shows a tab distinctly labeled as
	// debug-launched — not a generic "Terminal N".
	const debugTab = page.locator(".plain-terminal-tab", {
		hasText: "Debug: /usr/bin/python3 main.py",
	});
	await expect(debugTab).toBeVisible();
	await expect(page.locator(".plain-terminal-surface")).toBeVisible();

	// Meaningful assertion 2: real data actually flows through this exact
	// session id — proving this is a genuine, live terminal pane attached to
	// the real session, not a static label with nothing behind it.
	await pushTerminalOutput(page, "hello-from-debuggee", terminalSessionId);
	await expect(page.locator(".plain-terminal-grid")).toContainText(
		"hello-from-debuggee",
	);

	// Meaningful assertion 3: the user can kill it through the exact same
	// ordinary path any other terminal tab uses — proving no hidden,
	// debug-domain-only teardown path exists.
	await debugTab.locator(".plain-terminal-tab-close").click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_kill")).length)
		.toBe(1);
	expect(
		(await terminalCallsFor(page, "terminal_kill"))[0]!.args.request,
	).toEqual({ sessionId: terminalSessionId, immediate: false });
	await expect(debugTab).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

/** `F100` S5's own real notification-toast assertion for `plain/sessionEnded`
 * — see `plain-debug-session-alerts.ts`'s own module doc for why a
 * deliberate `Plain: Stop Debugging` never triggers it (proven here as the
 * control-group half of this same test): `DebugSessionController.disconnect`
 * clears its own state to `null` *before* any teardown-triggered
 * `plain/sessionEnded` could arrive, so `#handleEvent` drops it, and this
 * mock's own `debug_disconnect` case does not even attempt to emit one. */
test("shows a distinct notification naming the real reason when a debug session ends unexpectedly, but not when the user deliberately stops debugging", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(page, "arrayBuffer", "readonly", {
		"main.py": DEBUG_MAIN_PY,
		".vscode/launch.json": DEBUG_LAUNCH_JSON,
	});

	const toasts = page.locator(".notifications-toasts .notification-toast");
	const transportClosedToast = toasts.filter({
		hasText: "the debug adapter's connection closed unexpectedly",
	});
	const malformedFrameToast = toasts.filter({
		hasText: "sent a malformed message and the debugging session had to end",
	});

	// Control, run *first* (before any session-ended toast has ever
	// appeared, so there is nothing pre-existing to roll off and no risk of
	// a stale earlier toast producing a false pass): a deliberate `Plain:
	// Stop Debugging` must show no such notification at all.
	await launchDebugSessionThroughBothDialogs(page);
	await executePaletteCommand(page, "Stop Debugging", "Plain: Stop Debugging");
	await expect
		.poll(async () => (await terminalCallsFor(page, "debug_disconnect")).length)
		.toBe(1);
	await expect(toasts).toHaveCount(0);

	// Meaningful interaction 1: a real `transportClosed` session end shows a
	// notification naming that exact reason. Asserted immediately after
	// firing (rather than kept around to compare against later toasts): this
	// Workbench's own notification service does not guarantee an indefinite
	// backlog of toasts stays visible forever, so each reason is checked at
	// the moment it actually happens, matching how a real user would
	// perceive it.
	const firstSessionId = await launchDebugSessionThroughBothDialogs(page);
	await emitDebugTestEvent(page, firstSessionId, "plain/sessionEnded", {
		reason: "transportClosed",
	});
	await expect(transportClosedToast).toHaveCount(1);
	await expect(malformedFrameToast).toHaveCount(0);

	// Meaningful interaction 2: a distinct real reason (`malformedFrame`, a
	// fresh session so `DebugSessionController`'s own state is live again)
	// shows genuinely different text, not a copy-pasted generic message.
	const secondSessionId = await launchDebugSessionThroughBothDialogs(page);
	await emitDebugTestEvent(page, secondSessionId, "plain/sessionEnded", {
		reason: "malformedFrame",
	});
	await expect(malformedFrameToast).toHaveCount(1);

	expect(pageErrors).toEqual([]);
});

test("Debug Console acks every real output event it renders and shows an honest elision notice for content the backpressure gate had to drop, in the real order it arrived", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(page, "arrayBuffer", "readonly", {
		"main.py": DEBUG_MAIN_PY,
		".vscode/launch.json": DEBUG_LAUNCH_JSON,
	});

	const sessionId = await launchDebugSessionThroughBothDialogs(page);
	await executePaletteCommand(page, "Debug Console", "Plain: Debug Console");
	const lines = page.locator(".plain-debug-console-view-line");

	// Meaningful interaction 1: a real, immediately-emitted `output` event
	// (carrying the backpressure gate's own `sequence` field — see
	// `src-tauri/src/debug/output_gate.rs`) is both rendered *and* really
	// acked through the real `debug_output_ack` command (not merely
	// rendered) — proving `PlainDebugConsoleView` is the genuine production
	// caller `PlainBridge.debugOutputAck`'s own doc comment describes.
	await emitDebugTestEvent(page, sessionId, "output", {
		category: "stdout",
		output: "first line",
		sequence: 1,
	});
	await expect(lines).toHaveCount(1);
	await expect(lines.first()).toHaveText("first line");
	await expect
		.poll(async () => (await terminalCallsFor(page, "debug_output_ack")).length)
		.toBe(1);
	expect(
		(await terminalCallsFor(page, "debug_output_ack"))[0]!.args.request,
	).toEqual({ sessionId, sequence: 1 });

	// Meaningful interaction 2: `plain/outputElided` — the gate's own honest
	// "some output was dropped" signal, fired once real content genuinely
	// exceeded its per-category merge cap while gated — renders as its own
	// real, visible line naming both real numbers, never a silent gap.
	await emitDebugTestEvent(page, sessionId, "plain/outputElided", {
		category: "stdout",
		elidedBytes: 138_624,
		elidedLines: 512,
	});
	await expect(lines).toHaveCount(2);
	await expect(lines.nth(1)).toContainText("138624");
	await expect(lines.nth(1)).toContainText("512");

	// Meaningful interaction 3: the merged flush that follows the elision
	// notice (a later `sequence`) renders *after* it, in real arrival order,
	// and is itself acked too — proving the console keeps consuming output
	// normally after an elision, rather than getting stuck.
	await emitDebugTestEvent(page, sessionId, "output", {
		category: "stdout",
		output: "resumed after the gap",
		sequence: 2,
	});
	await expect(lines).toHaveCount(3);
	await expect(lines.nth(2)).toHaveText("resumed after the gap");
	await expect
		.poll(async () => (await terminalCallsFor(page, "debug_output_ack")).length)
		.toBe(2);
	expect(
		(await terminalCallsFor(page, "debug_output_ack"))[1]!.args.request,
	).toEqual({ sessionId, sequence: 2 });

	expect(pageErrors).toEqual([]);
});

// --- `F210` S4 "step-into target picker" ------------------------------------

const STEP_IN_TARGET_STACK_FRAMES_FIXTURE = Object.freeze({
	1: [
		Object.freeze({
			id: 10,
			name: "main",
			line: 6,
			column: 0,
			sourcePath: null,
			sourceName: "main.py",
			instructionPointerReference: null,
		}),
	],
});

test("Plain: Step Into Target… fetches real stepInTargets for the selected frame, shows a picker, and sends the chosen id to debug_step_in", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{ "main.py": DEBUG_MAIN_PY, ".vscode/launch.json": DEBUG_LAUNCH_JSON },
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		false,
		{},
		{},
		{
			capabilities: { supportsStepInTargetsRequest: true },
			stackFramesByThread: STEP_IN_TARGET_STACK_FRAMES_FIXTURE,
			stepInTargetsByFrame: {
				10: [
					{ id: 100, label: "add(3, 4)" },
					{ id: 101, label: "helper()" },
				],
			},
		},
	);

	const sessionId = await launchDebugSessionThroughBothDialogs(page);
	await emitDebugTestEvent(page, sessionId, "stopped", {
		threadId: 1,
		reason: "breakpoint",
	});
	// Synchronizes on the call stack view's own real `debug_stack_trace`
	// fetch/render completing (see `PlainDebugCallStackView#refresh`) — this
	// is also what selects frame id 10, the frame this command must query
	// `debug_step_in_targets` for below.
	await expect(page.locator(".plain-debug-call-stack-view-frame")).toHaveCount(
		1,
	);

	await executePaletteCommandThatMayReopenAQuickInput(
		page,
		"Step Into Target",
		"Plain: Step Into Target…",
	);

	const picker = page.locator(".quick-input-widget");
	await expect(picker.locator("input")).toHaveAttribute(
		"placeholder",
		"Select a step-into target",
	);
	const rows = picker.locator(".quick-input-list .monaco-list-row");
	await expect(rows).toHaveCount(2);
	const secondRow = rows.filter({ hasText: "helper()" });
	await expect(secondRow).toHaveCount(1);
	await secondRow.click();
	await expect(picker).toBeHidden();

	// The real `debug_step_in_targets` call was scoped to the selected frame
	// (10), and the picker's own selection — the *second* target, not the
	// first — drove the real `targetId` this domain sent.
	expect(
		(await terminalCallsFor(page, "debug_step_in_targets"))[0]!.args.request,
	).toEqual({ sessionId, frameId: 10 });
	await expect
		.poll(async () => (await terminalCallsFor(page, "debug_step_in")).length)
		.toBe(1);
	expect(
		(await terminalCallsFor(page, "debug_step_in"))[0]!.args.request,
	).toEqual({ sessionId, threadId: 1, targetId: 101 });

	expect(pageErrors).toEqual([]);
});

test("Plain: Step Into Target… reports an accurate message and issues zero IPC when the adapter's capabilities do not advertise support", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{ "main.py": DEBUG_MAIN_PY, ".vscode/launch.json": DEBUG_LAUNCH_JSON },
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		false,
		{},
		{},
		{
			// No `capabilities` override — defaults to `{}`, so
			// `supportsStepInTargetsRequest` is not `true`.
			stackFramesByThread: STEP_IN_TARGET_STACK_FRAMES_FIXTURE,
		},
	);

	const sessionId = await launchDebugSessionThroughBothDialogs(page);
	await emitDebugTestEvent(page, sessionId, "stopped", {
		threadId: 1,
		reason: "breakpoint",
	});
	await expect(page.locator(".plain-debug-call-stack-view-frame")).toHaveCount(
		1,
	);

	await executePaletteCommand(
		page,
		"Step Into Target",
		"Plain: Step Into Target…",
	);

	await expect(
		page.locator(".notifications-toasts .notification-toast").filter({
			hasText: "does not support step-into targets",
		}),
	).toHaveCount(1);
	expect(await terminalCallsFor(page, "debug_step_in_targets")).toEqual([]);
	expect(await terminalCallsFor(page, "debug_step_in")).toEqual([]);

	expect(pageErrors).toEqual([]);
});

test("cancelling the step-into target picker sends no debug_step_in and leaves no other trace", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{ "main.py": DEBUG_MAIN_PY, ".vscode/launch.json": DEBUG_LAUNCH_JSON },
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		false,
		{},
		{},
		{
			capabilities: { supportsStepInTargetsRequest: true },
			stackFramesByThread: STEP_IN_TARGET_STACK_FRAMES_FIXTURE,
			stepInTargetsByFrame: {
				10: [
					{ id: 100, label: "add(3, 4)" },
					{ id: 101, label: "helper()" },
				],
			},
		},
	);

	const sessionId = await launchDebugSessionThroughBothDialogs(page);
	await emitDebugTestEvent(page, sessionId, "stopped", {
		threadId: 1,
		reason: "breakpoint",
	});
	await expect(page.locator(".plain-debug-call-stack-view-frame")).toHaveCount(
		1,
	);

	await executePaletteCommandThatMayReopenAQuickInput(
		page,
		"Step Into Target",
		"Plain: Step Into Target…",
	);
	const picker = page.locator(".quick-input-widget");
	await expect(picker.locator("input")).toHaveAttribute(
		"placeholder",
		"Select a step-into target",
	);
	await page.keyboard.press("Escape");
	await expect(picker).toBeHidden();

	// Fetching the real target list to populate the picker (a read) already
	// happened by the time the picker appeared — cancellation's own "zero
	// side effects" claim is about the mutating `stepIn` call it prevents,
	// exactly like the launch-configuration picker's own cancellation test
	// above (which likewise still reads `.vscode/launch.json` before its own
	// picker appears).
	expect(await terminalCallsFor(page, "debug_step_in_targets")).toHaveLength(1);
	expect(await terminalCallsFor(page, "debug_step_in")).toEqual([]);
	await expect(
		page.locator(".notifications-toasts .notification-toast"),
	).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

// --- `F210` S5 "read-only disassembly view" ---------------------------------

const DISASSEMBLY_STACK_FRAMES_FIXTURE = Object.freeze({
	1: [
		Object.freeze({
			id: 10,
			name: "main",
			line: 6,
			column: 0,
			sourcePath: "main.py",
			sourceName: "main.py",
			instructionPointerReference: "0x1000",
		}),
	],
});

const DISASSEMBLY_INSTRUCTIONS_FIXTURE = Object.freeze({
	"0x1000": {
		0: [
			Object.freeze({
				address: "0x1000",
				instructionBytes: "55",
				instruction: "push rbp",
				symbol: "main",
			}),
			Object.freeze({
				address: "0x1001",
				instructionBytes: "48 89 e5",
				instruction: "mov rbp, rsp",
				symbol: null,
			}),
			Object.freeze({
				address: "0x1004",
				instructionBytes: null,
				instruction: "nop",
				symbol: null,
			}),
		],
		"-100": [
			Object.freeze({
				address: "0x0f9c",
				instructionBytes: "90",
				instruction: "nop",
				symbol: null,
			}),
		],
	},
});

test("Plain: Open Disassembly shows the real instruction window with address/bytes/instruction columns, highlights the anchor row, and requests the correct bounded window", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{ "main.py": DEBUG_MAIN_PY, ".vscode/launch.json": DEBUG_LAUNCH_JSON },
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		false,
		{},
		{},
		{
			capabilities: { supportsDisassembleRequest: true },
			stackFramesByThread: DISASSEMBLY_STACK_FRAMES_FIXTURE,
			disassemblyByMemoryReference: DISASSEMBLY_INSTRUCTIONS_FIXTURE,
		},
	);

	const sessionId = await launchDebugSessionThroughBothDialogs(page);
	await emitDebugTestEvent(page, sessionId, "stopped", {
		threadId: 1,
		reason: "breakpoint",
	});
	await expect(page.locator(".plain-debug-call-stack-view-frame")).toHaveCount(
		1,
	);

	await executePaletteCommand(
		page,
		"Open Disassembly",
		"Plain: Open Disassembly",
	);

	await expect
		.poll(
			async () => (await terminalCallsFor(page, "debug_disassemble")).length,
		)
		.toBe(1);
	expect(
		(await terminalCallsFor(page, "debug_disassemble"))[0]!.args.request,
	).toEqual({
		sessionId,
		memoryReference: "0x1000",
		instructionOffset: 0,
		instructionCount: 100,
	});

	const rows = page.locator(".plain-debug-disassembly-view-instruction");
	await expect(rows).toHaveCount(3);
	await expect(rows.nth(0)).toHaveClass(
		/plain-debug-disassembly-view-instruction-current/,
	);
	await expect(
		rows.nth(0).locator(".plain-debug-disassembly-view-address"),
	).toHaveText("0x1000");
	await expect(
		rows.nth(0).locator(".plain-debug-disassembly-view-bytes"),
	).toHaveText("55");
	await expect(
		rows.nth(0).locator(".plain-debug-disassembly-view-instruction-text"),
	).toHaveText("push rbp (main)");
	await expect(rows.nth(1)).not.toHaveClass(
		/plain-debug-disassembly-view-instruction-current/,
	);
	await expect(
		rows.nth(1).locator(".plain-debug-disassembly-view-instruction-text"),
	).toHaveText("mov rbp, rsp");
	await expect(
		rows.nth(2).locator(".plain-debug-disassembly-view-bytes"),
	).toHaveText("");
	await expect(
		rows.nth(2).locator(".plain-debug-disassembly-view-instruction-text"),
	).toHaveText("nop");

	expect(pageErrors).toEqual([]);
});

test("Plain: Open Disassembly paging sends the correct bounded instructionOffset each step and keeps a single request in flight", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{ "main.py": DEBUG_MAIN_PY, ".vscode/launch.json": DEBUG_LAUNCH_JSON },
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		false,
		{},
		{},
		{
			capabilities: { supportsDisassembleRequest: true },
			stackFramesByThread: DISASSEMBLY_STACK_FRAMES_FIXTURE,
			disassemblyByMemoryReference: DISASSEMBLY_INSTRUCTIONS_FIXTURE,
			// Keeps each `debug_disassemble` response genuinely in flight long
			// enough for this test to observe the Up/Down buttons really
			// disabled for its whole duration, instead of racing a same-tick
			// mock response.
			disassembleDelayMsForTest: 200,
		},
	);

	const sessionId = await launchDebugSessionThroughBothDialogs(page);
	await emitDebugTestEvent(page, sessionId, "stopped", {
		threadId: 1,
		reason: "breakpoint",
	});
	await expect(page.locator(".plain-debug-call-stack-view-frame")).toHaveCount(
		1,
	);
	await executePaletteCommand(
		page,
		"Open Disassembly",
		"Plain: Open Disassembly",
	);
	await expect
		.poll(
			async () => (await terminalCallsFor(page, "debug_disassemble")).length,
		)
		.toBe(1);

	const upButton = page.locator(".plain-debug-disassembly-view-up");
	const downButton = page.locator(".plain-debug-disassembly-view-down");
	await expect(upButton).toBeEnabled();
	await expect(downButton).toBeEnabled();

	await upButton.click();
	// Single in-flight: both paging buttons are disabled for the whole
	// duration of the request the click just started.
	await expect(upButton).toBeDisabled();
	await expect(downButton).toBeDisabled();
	await expect
		.poll(
			async () => (await terminalCallsFor(page, "debug_disassemble")).length,
		)
		.toBe(2);
	expect(
		(await terminalCallsFor(page, "debug_disassemble"))[1]!.args.request,
	).toEqual({
		sessionId,
		memoryReference: "0x1000",
		instructionOffset: -100,
		instructionCount: 100,
	});
	await expect(upButton).toBeEnabled();
	await expect(downButton).toBeEnabled();
	await expect(
		page.locator(".plain-debug-disassembly-view-instruction"),
	).toHaveCount(1);
	// No row is the anchor while paged away from offset zero.
	await expect(
		page.locator(".plain-debug-disassembly-view-instruction-current"),
	).toHaveCount(0);

	await downButton.click();
	await expect
		.poll(
			async () => (await terminalCallsFor(page, "debug_disassemble")).length,
		)
		.toBe(3);
	expect(
		(await terminalCallsFor(page, "debug_disassemble"))[2]!.args.request,
	).toEqual({
		sessionId,
		memoryReference: "0x1000",
		instructionOffset: 0,
		instructionCount: 100,
	});
	await expect(
		page.locator(".plain-debug-disassembly-view-instruction"),
	).toHaveCount(3);

	expect(pageErrors).toEqual([]);
});

test("Plain: Open Disassembly shows accurate placeholders and issues zero debug_disassemble calls while not debugging, running, or the adapter lacks support", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(page, "arrayBuffer", "readonly", {
		"main.py": DEBUG_MAIN_PY,
		".vscode/launch.json": DEBUG_LAUNCH_JSON,
	});
	await openMainPy(page);

	// No live session at all.
	await executePaletteCommand(
		page,
		"Open Disassembly",
		"Plain: Open Disassembly",
	);
	const message = page.locator(".plain-debug-disassembly-view-message");
	await expect(message).toHaveText("Not debugging.");
	expect(await terminalCallsFor(page, "debug_disassemble")).toEqual([]);

	// A live session that has not stopped yet.
	const sessionId = await launchDebugSessionThroughBothDialogs(page);
	await expect(message).toHaveText("Running…");
	expect(await terminalCallsFor(page, "debug_disassemble")).toEqual([]);

	// Stopped, but the fixture's default `capabilities` (`{}`) never
	// advertises `supportsDisassembleRequest`.
	await emitDebugTestEvent(page, sessionId, "stopped", {
		threadId: 1,
		reason: "breakpoint",
	});
	await expect(message).toHaveText(
		"The current debug adapter does not support disassembly.",
	);
	expect(await terminalCallsFor(page, "debug_disassemble")).toEqual([]);
	await expect(
		page.locator(".plain-debug-disassembly-view-instruction"),
	).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

test("Plain: Open Disassembly shows an accurate placeholder when the stopped top frame reports no instructionPointerReference", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{ "main.py": DEBUG_MAIN_PY, ".vscode/launch.json": DEBUG_LAUNCH_JSON },
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		false,
		{},
		{},
		{
			capabilities: { supportsDisassembleRequest: true },
			// The one frame this fixture reports has no
			// `instructionPointerReference` at all (`null`, matching
			// `TestDebugStackFrame`'s own contract for a frame with no
			// resolvable address).
			stackFramesByThread: {
				1: [
					{
						id: 10,
						name: "main",
						line: 6,
						column: 0,
						sourcePath: "main.py",
						sourceName: "main.py",
						instructionPointerReference: null,
					},
				],
			},
		},
	);

	const sessionId = await launchDebugSessionThroughBothDialogs(page);
	await emitDebugTestEvent(page, sessionId, "stopped", {
		threadId: 1,
		reason: "breakpoint",
	});
	await expect(page.locator(".plain-debug-call-stack-view-frame")).toHaveCount(
		1,
	);
	await executePaletteCommand(
		page,
		"Open Disassembly",
		"Plain: Open Disassembly",
	);

	await expect(
		page.locator(".plain-debug-disassembly-view-message"),
	).toHaveText("No instruction pointer is available for the current frame.");
	expect(await terminalCallsFor(page, "debug_disassemble")).toEqual([]);

	expect(pageErrors).toEqual([]);
});

test("Plain: Open Disassembly clears back to a placeholder once stopped ends, whether by continuing or the session terminating", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{ "main.py": DEBUG_MAIN_PY, ".vscode/launch.json": DEBUG_LAUNCH_JSON },
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		false,
		{},
		{},
		{
			capabilities: { supportsDisassembleRequest: true },
			stackFramesByThread: DISASSEMBLY_STACK_FRAMES_FIXTURE,
			disassemblyByMemoryReference: DISASSEMBLY_INSTRUCTIONS_FIXTURE,
		},
	);

	const sessionId = await launchDebugSessionThroughBothDialogs(page);
	await emitDebugTestEvent(page, sessionId, "stopped", {
		threadId: 1,
		reason: "breakpoint",
	});
	await expect(page.locator(".plain-debug-call-stack-view-frame")).toHaveCount(
		1,
	);
	await executePaletteCommand(
		page,
		"Open Disassembly",
		"Plain: Open Disassembly",
	);
	await expect(
		page.locator(".plain-debug-disassembly-view-instruction"),
	).toHaveCount(3);

	// `continue`/step ends the stopped state: the view clears and reports
	// "Running…", zero residual rows.
	await emitDebugTestEvent(page, sessionId, "continued", null);
	await expect(
		page.locator(".plain-debug-disassembly-view-message"),
	).toHaveText("Running…");
	await expect(
		page.locator(".plain-debug-disassembly-view-instruction"),
	).toHaveCount(0);

	// A real `stopped` event re-populates it...
	await emitDebugTestEvent(page, sessionId, "stopped", {
		threadId: 1,
		reason: "step",
	});
	await expect(
		page.locator(".plain-debug-disassembly-view-instruction"),
	).toHaveCount(3);

	// ...and session termination clears it back to "Not debugging.", not just
	// "Running…".
	await emitDebugTestEvent(page, sessionId, "plain/sessionEnded", {
		reason: "transportClosed",
	});
	await expect(
		page.locator(".plain-debug-disassembly-view-message"),
	).toHaveText("Not debugging.");
	await expect(
		page.locator(".plain-debug-disassembly-view-instruction"),
	).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

// --- `F210` S6 "spawn-then-connect 编排" -------------------------------------

// A `"tcpSpawn"` inline `plainAdapter` override — spawn `command`/`args` as a
// companion process, then connect to it on the fixed `127.0.0.1` loopback
// address at `port` (`docs/research/2026-08-04-complete-debug.md`'s "架构裁定
// §6"). Deliberately no `host` field at all, mirroring `DEBUG_LAUNCH_JSON`'s
// own `"stdio"` fixture shape one field over.
const DEBUG_LAUNCH_JSON_TCP_SPAWN = JSON.stringify({
	version: "0.2.0",
	configurations: [
		{
			type: "debugpy-listen",
			request: "launch",
			name: "Debug main.py (spawn then connect)",
			plainAdapter: {
				transport: "tcpSpawn",
				command: "/usr/bin/python3",
				args: ["-m", "debugpy.adapter", "--listen"],
				port: 5678,
			},
			program: "main.py",
		},
	],
});

test("Plain: Start Debugging spawns then connects a tcpSpawn adapter, shows the accurate spawn-then-connect confirm dialog text, and starts a live session", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(page, "arrayBuffer", "readonly", {
		"main.py": DEBUG_MAIN_PY,
		".vscode/launch.json": DEBUG_LAUNCH_JSON_TCP_SPAWN,
	});

	await openMainPy(page);
	await openRunAndDebugView(page);
	await executePaletteCommand(
		page,
		"Start Debugging",
		"Plain: Start Debugging",
	);

	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText(
		"Trust this workspace to run a debug adapter?",
	);
	await dialog
		.getByRole("button", { name: "Trust & Continue", exact: true })
		.click();
	await expect(dialog).toBeVisible();

	// The confirmation dialog must accurately say "start <command> and
	// connect to 127.0.0.1:<port>" — not the plain "run <command>" copy a
	// stdio/connect-only tcp adapter shows — see this feature's own
	// `docs/research/2026-08-04-complete-debug.md` "架构裁定 §6".
	await expect(dialog).toContainText(
		'Start "/usr/bin/python3" and connect to 127.0.0.1:5678?',
	);
	await expect(dialog).toContainText("127.0.0.1:5678");
	await dialog
		.getByRole("button", { name: "Run Adapter", exact: true })
		.click();
	await expect(dialog).toHaveCount(0);

	await expect
		.poll(async () => (await terminalCallsFor(page, "debug_launch")).length)
		.toBe(1);
	const launches = await terminalCallsFor(page, "debug_launch");
	expect(launches[0]?.args.request).toEqual({
		rootId: nativeRootId,
		transport: "tcpSpawn",
		command: "/usr/bin/python3",
		args: ["-m", "debugpy.adapter", "--listen"],
		adapterId: "debugpy-listen",
		arguments: { program: "main.py" },
		initialBreakpoints: [],
		port: 5678,
	});

	// A real live session exists — the composed spawn-then-connect mock
	// outcome defaults to `"success"`.
	const sessionId = await currentDebugSessionId(page);
	expect(sessionId).toBeTruthy();

	expect(pageErrors).toEqual([]);
});

async function startTcpSpawnDebuggingThroughBothDialogs(
	page: Page,
): Promise<void> {
	await openMainPy(page);
	await openRunAndDebugView(page);
	await executePaletteCommand(
		page,
		"Start Debugging",
		"Plain: Start Debugging",
	);
	// Scoped to `.monaco-dialog-box` (the real `IDialogService.confirm`
	// modal's own class) rather than a bare `page.getByRole("dialog")` — see
	// `"Network pull fails closed..."`'s own comment above for why: the error
	// notification toast this helper's own callers expect to appear right
	// after the second click is *itself* a `role="dialog"` list row, so an
	// unscoped role query would still find it and never reach `toHaveCount(0)`.
	const dialog = page.locator(".monaco-dialog-box");
	await expect(dialog).toBeVisible();
	await dialog
		.getByRole("button", { name: "Trust & Continue", exact: true })
		.click();
	await expect(dialog).toBeVisible();
	await dialog
		.getByRole("button", { name: "Run Adapter", exact: true })
		.click();
	await expect(dialog).toHaveCount(0);
}

async function liveDebugSessionIds(page: Page): Promise<readonly string[]> {
	return page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_DEBUG_SESSION_IDS__(): readonly string[];
		};
		return testWindow.__PLAIN_TEST_DEBUG_SESSION_IDS__();
	});
}

test("Plain: Start Debugging reports an accurate error and leaves zero session residue when the tcpSpawn companion exits before ever listening", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{
			"main.py": DEBUG_MAIN_PY,
			".vscode/launch.json": DEBUG_LAUNCH_JSON_TCP_SPAWN,
		},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		false,
		{},
		{},
		{ tcpSpawnOutcomeForTest: "processExitedBeforeListening" },
	);

	await startTcpSpawnDebuggingThroughBothDialogs(page);

	const toasts = page.locator(".notifications-toasts .notification-toast");
	await expect(toasts).toContainText(
		"The spawned debug adapter process exited before Plain could connect to its TCP listener.",
	);

	expect(await liveDebugSessionIds(page)).toEqual([]);
	expect(pageErrors).toEqual([]);
});

test("Plain: Start Debugging reports an accurate error and leaves zero session residue when the tcpSpawn connect budget is exhausted", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{
			"main.py": DEBUG_MAIN_PY,
			".vscode/launch.json": DEBUG_LAUNCH_JSON_TCP_SPAWN,
		},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		false,
		{},
		{},
		{ tcpSpawnOutcomeForTest: "connectTimedOut" },
	);

	await startTcpSpawnDebuggingThroughBothDialogs(page);

	const toasts = page.locator(".notifications-toasts .notification-toast");
	await expect(toasts).toContainText(
		"Timed out waiting for the spawned debug adapter's TCP listener to become ready.",
	);

	expect(await liveDebugSessionIds(page)).toEqual([]);
	expect(pageErrors).toEqual([]);
});

test("Plain: Start Debugging still supports the existing stdio adapter path unchanged alongside the new tcpSpawn variant", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(page, "arrayBuffer", "readonly", {
		"main.py": DEBUG_MAIN_PY,
		".vscode/launch.json": DEBUG_LAUNCH_JSON,
	});

	const sessionId = await launchDebugSessionThroughBothDialogs(page);
	expect(sessionId).toBeTruthy();
	const launches = await terminalCallsFor(page, "debug_launch");
	expect(launches[0]?.args.request).toMatchObject({
		transport: "stdio",
		command: "/usr/bin/python3",
	});

	expect(pageErrors).toEqual([]);
});

// --- `F110` S4 "globalCompositeBar migrated into app/" ---------------------

test("the Manage gear renders in the Activity Bar, its context menu carries real Activity Bar Position content through the migrated composite bar, and its main menu opens without error", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	await installNativeIpcMock(page, "arrayBuffer");
	await openNativeWorkspaceExplorer(page);

	// The "Manage" gear itself: `PlainGlobalCompositeBar`'s bottom composite
	// bar action, rendered by `PlainGlobalActivityActionViewItem`
	// (`app/features/workbench/plain-global-composite-bar.ts`). Selector found
	// by inspecting the real rendered DOM (a throwaway
	// `document.querySelectorAll('.activitybar [aria-label]')` dump against a
	// real dev-server page), not guessed: the accessible name comes from
	// `CompositeBarAction`'s own `name: "Manage"` (set in the ported
	// constructor) and renders as `aria-label="Manage"` on the single
	// `<li role="button">` activity item that Playwright's accessibility tree
	// reports as `button "Manage"`.
	const manageGear = page.getByRole("button", { name: "Manage" });
	await expect(manageGear).toHaveCount(1);
	await expect(manageGear).toBeVisible();

	// Right-click: `PlainAbstractGlobalActivityActionViewItem.openContextMenu`
	// -> `resolveContextMenuActions` -> the `contextMenuActionsProvider`
	// closure `activitybarPart.js` passes into `PlainGlobalCompositeBar`'s
	// constructor (`() => this.getContextMenuActions()`), which runs the
	// vendor `ActivitybarPart`'s own unpatched `fillContextMenuActions` ->
	// `getActivityBarContextMenuActions()`. "Activity Bar Position" is that
	// menu's own `SubmenuAction` (real vendor code, confirmed by reading
	// `activitybarPart.js` directly -- present regardless of this slice's
	// patch, which only redirects which class gets constructed, not this
	// closure). Seeing it here proves the ported `contextMenuActionsProvider`
	// plumbing carries real content end to end through the patched
	// `activitybarPart.js`, not merely that a DOM node with the right class
	// renders.
	await manageGear.click({ button: "right" });
	await expect(
		page.getByRole("menuitem", { name: "Activity Bar Position" }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.locator(".context-view")).toBeHidden();

	// Left-click: `PlainAbstractGlobalActivityActionViewItem.run()` ->
	// `resolveMainMenuActions` -> `menu.getActions()` against the real
	// `MenuId.GlobalActivity` menu. This test's own brief assumed that menu is
	// currently empty in this product; real inspection (right here, via the
	// dev server, not assumed) found that assumption wrong: `@codingame/
	// monaco-vscode-quickaccess-service-override`'s `quickAccess.
	// contribution.js` registers a "Command Palette..." item and `@codingame/
	// monaco-vscode-theme-service-override`'s `themes.contribution.js`
	// registers a "Themes" submenu into `MenuId.GlobalActivity`, both real,
	// always-on vendor registrations entirely unrelated to this slice's
	// `authAccount` migration. So this asserts that real content, rather than
	// only "no error was thrown".
	await manageGear.click();
	await expect(
		page.getByRole("menuitem", { name: /^Command Palette/ }),
	).toBeVisible();
	await expect(page.getByRole("menuitem", { name: "Themes" })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.locator(".context-view")).toBeHidden();

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

// --- `F170` S1 local settings / keybindings / Auto Save --------------------

test("persists local keybindings and settings through Rust-shaped IPC, reloads the shortcut, and Auto Saves an edited workspace file", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") consoleErrors.push(message.text());
	});

	await installNativeIpcMock(page, "arrayBuffer", "supported");
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	await executePaletteCommand(
		page,
		"Open Local Keyboard Shortcuts",
		"Plain: Open Local Keyboard Shortcuts (JSON)",
	);
	const keybindingsTab = page.locator(".tabs-container .tab.active");
	await expect(keybindingsTab).toContainText("keybindings.json");
	await page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "[]" })
		.click();
	const keybindings =
		'[{"key":"ctrl+alt+u","command":"plain.preferences.openLocalSettings"}]';
	await page.keyboard.press("ControlOrMeta+A");
	await page.keyboard.type(keybindings);
	// Monaco keeps the quote/object/array auto-closers it created for the
	// opening characters when Playwright enters the full JSON quickly. Remove
	// those three synthetic suffix characters just as a user typing or pasting
	// over this tiny default file would.
	await page.keyboard.press("End");
	await page.keyboard.press("Backspace");
	await page.keyboard.press("Backspace");
	await page.keyboard.press("Backspace");
	await expect(keybindingsTab).toHaveClass(/dirty/);
	await page.keyboard.press("ControlOrMeta+S");
	await expect
		.poll(async () =>
			page.evaluate(() => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				};
				return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
					({ command, args }) =>
						command === "user_data_write" &&
						(args.request as { resource?: unknown } | undefined)?.resource ===
							"keybindings",
				).length;
			}),
		)
		.toBe(1);
	await expect(keybindingsTab).not.toHaveClass(/dirty/);
	await page.keyboard.press("ControlOrMeta+W");
	await expect(
		page.getByRole("tab", { name: /keybindings\.json/i }),
	).toHaveCount(0);

	await expect
		.poll(
			async () => {
				await page.keyboard.press("Control+Alt+U");
				return page.getByRole("tab", { name: /settings\.json/i }).count();
			},
			{ timeout: 5_000 },
		)
		.toBe(1);
	const settingsTab = page.locator(".tabs-container .tab.active");
	await expect(settingsTab).toContainText("settings.json");
	await page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "{}" })
		.click();
	const settings = '{"files.autoSave":"afterDelay","files.autoSaveDelay":750}';
	await page.keyboard.press("ControlOrMeta+A");
	await page.keyboard.type(settings);
	await page.keyboard.press("End");
	await page.keyboard.press("Backspace");
	await page.keyboard.press("Backspace");
	await page.keyboard.press("ControlOrMeta+S");
	await expect
		.poll(async () =>
			page.evaluate(() => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				};
				return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
					({ command, args }) =>
						command === "user_data_write" &&
						(args.request as { resource?: unknown } | undefined)?.resource ===
							"settings",
				).length;
			}),
		)
		.toBe(1);
	const userDataWrites = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		return testWindow.__PLAIN_TEST_TAURI_CALLS__
			.filter(({ command }) => command === "user_data_write")
			.map(({ args }) => args.request);
	});
	expect(userDataWrites).toEqual([
		{ resource: "keybindings", expectedRevision: 1, content: keybindings },
		{ resource: "settings", expectedRevision: 1, content: settings },
	]);

	await executePaletteCommand(page, "Open Folder", "File: Open Folder...");
	await page.getByRole("tab", { name: /^Explorer / }).click();
	const explorer = page.getByRole("tree", { name: "Files Explorer" });
	await expect(explorer).toBeVisible();
	const readme = explorer.getByRole("treeitem", {
		name: "README.md",
		exact: true,
	});
	await readme.dblclick();
	const editor = page
		.getByRole("code")
		.filter({ hasText: "Read-only Explorer fixture." });
	await expect(editor).toBeVisible();
	await page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "Read-only Explorer fixture." })
		.click();
	expect(await nativeWriteFileCalls(page)).toEqual([]);
	await page.keyboard.press("End");
	const autoSaveMarker = " Auto-saved by local settings.";
	await page.keyboard.insertText(autoSaveMarker);
	const workspaceTab = page.locator(".tabs-container .tab.active");
	await expect
		.poll(async () => {
			const writes = await nativeWriteFileCalls(page);
			const latest = writes.at(-1);
			return latest === undefined
				? undefined
				: {
						relativePath: latest.request.relativePath,
						contentHex: latest.contentHex,
					};
		})
		.toEqual({
			relativePath: "README.md",
			contentHex: hexOfText(
				`# Native workspace\n\nRead-only Explorer fixture.${autoSaveMarker}\n`,
			),
		});
	await expect(workspaceTab).not.toHaveClass(/dirty/);

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

// ---------------------------------------------------------------------
// `F220` S1 — SSH session and host-key trust foundation. No workspace root
// is opened for any of these: `plain.remote.*` commands never gate on one
// (unlike `plain.debug.*`/`plain.search.*`), so `installNativeIpcMock`'s
// fixed native root is deliberately left unselected throughout.
// ---------------------------------------------------------------------

/** Drives the three sequential `IQuickInputService.input` prompts "Plain:
 * Connect to SSH Host…" shows (host, user, port) — the command palette
 * entry point itself must already have been opened via
 * `executePaletteCommandThatMayReopenAQuickInput` before calling this,
 * exactly mirroring `F210` S4's own step-into-target picker precedent for a
 * command whose own continuation immediately reopens the same
 * `.quick-input-widget` shell. `port` left `undefined` accepts the
 * command's own prefilled `"22"` default unchanged. */
async function fillConnectToSshHostPrompts(
	page: Page,
	host: string,
	user: string,
	port?: string,
): Promise<void> {
	const palette = page.locator(".quick-input-widget");
	await expect(palette).toBeVisible();
	await expect(palette.locator("input")).toHaveAttribute(
		"placeholder",
		"example.com or 192.168.1.10",
	);
	await palette.locator("input").pressSequentially(host);
	await page.keyboard.press("Enter");

	await expect(palette).toBeVisible();
	await expect(palette.locator("input")).toHaveAttribute(
		"placeholder",
		"octocat",
	);
	await palette.locator("input").pressSequentially(user);
	await page.keyboard.press("Enter");

	await expect(palette).toBeVisible();
	await expect(palette.locator("input")).toHaveValue("22");
	if (port !== undefined) {
		await palette.locator("input").fill(port);
	}
	await page.keyboard.press("Enter");
}

/** `F220` S3 — connects one mock SSH session end to end (host-key dialog
 * confirmed) via the exact same command/dialog flow
 * `fillConnectToSshHostPrompts`'s own callers already use; every remote
 * workspace test below needs a live session before "Plain: Open Remote
 * Folder…" will do anything but prompt to connect first. */
async function connectMockSshSession(
	page: Page,
	host: string,
	user: string,
): Promise<void> {
	await executePaletteCommandThatMayReopenAQuickInput(
		page,
		"Connect to SSH Host",
		"Plain: Connect to SSH Host…",
	);
	await fillConnectToSshHostPrompts(page, host, user);
	const confirmDialog = page.getByRole("dialog");
	await expect(confirmDialog).toBeVisible();
	await confirmDialog
		.getByRole("button", { name: "Connect", exact: true })
		.click();
	await expect(confirmDialog).toHaveCount(0);
}

/** `F220` S3 — drives "Plain: Open Remote Folder…" end to end: picks the
 * (only) live session, walks `segments` one directory QuickPick selection at
 * a time, then confirms "Use This Folder" and accepts the optional
 * display-name prompt's default. Mirrors `plain-remote-workspace-browse.ts`'s
 * own item ordering (useCurrent, up, entries, loadMore) — this only ever
 * clicks directory rows and the final useCurrent row. */
async function openRemoteFolderViaQuickPick(
	page: Page,
	segments: readonly string[],
): Promise<void> {
	await executePaletteCommandThatMayReopenAQuickInput(
		page,
		"Open Remote Folder",
		"Plain: Open Remote Folder…",
	);
	const picker = page.locator(".quick-input-widget");
	await expect(picker).toBeVisible();
	const sessionRows = picker.locator(".quick-input-list .monaco-list-row");
	await expect(sessionRows).toHaveCount(1);
	await sessionRows.first().click();

	for (const segment of segments) {
		await expect(picker).toBeVisible();
		const directoryItem = picker
			.locator(".quick-input-list .monaco-list-row")
			.filter({ hasText: segment });
		await expect(directoryItem).toHaveCount(1);
		await directoryItem.click();
	}

	await expect(picker).toBeVisible();
	const useCurrent = picker
		.locator(".quick-input-list .monaco-list-row")
		.filter({ hasText: "Use This Folder" });
	await expect(useCurrent).toHaveCount(1);
	await useCurrent.click();

	// The optional display-name `IQuickInputService.input` prompt reuses the
	// same widget shell; Enter accepts its prefilled placeholder default.
	await expect(picker).toBeVisible();
	await page.keyboard.press("Enter");
	await expect(picker).toBeHidden();
}

/**
 * `F220` S3 KNOWN LIMITATION — extensive investigation (see the session's
 * final report) established that a root authorized through
 * `WorkspaceTopologyCoordinator.runMutation()` (the only mechanism available
 * to "Plain: Open Remote Folder…", since a remote root cannot go through the
 * native-OS-picker-backed "Add Folder to Workspace" built-in command) renders
 * its Explorer tree and serves reads correctly, but the real Workbench
 * currently leaves it non-editable: Monaco's own `beforeinput` handling
 * silently drops every keystroke (no `input` event ever follows, no
 * console/page error, not a timing race — confirmed reproducible even after
 * an 8s+ settle window and prefixing with a genuine native "File: Open
 * Folder..." root), and the Explorer "New File.../New Folder..." toolbar
 * actions stay permanently `aria-disabled`. This reproduces identically for
 * `main.ts`/`main.rs`, with or without a native root already open, and is not
 * specific to any one editor language. Every *existing* test that grows the
 * root list mid-session does so through the built-in "Add Folder to
 * Workspace" command instead (never through a raw `runMutation` call the way
 * this slice's own remote-root authorization must), so this looks like a
 * previously-undiscovered gap in that shared coordinator/library path, not a
 * defect in this slice's own SFTP/remote-fs/DTO work — but it is a genuine,
 * separate functional gap this slice's own Browser E2E work surfaced, tracked
 * as `F220` S3 follow-up rather than silently worked around.
 *
 * Every helper below drives the *exact* wire command a real Save/Explorer
 * mutation would (same command name, same raw frame layout `native.ts`
 * itself encodes), proving the SFTP-backed mock/backend correctly serves
 * that root — without depending on the currently-blocked in-page editing
 * affordances.
 */
async function directTauriInvoke(
	page: Page,
	command: string,
	request: Record<string, unknown>,
): Promise<unknown> {
	return page.evaluate(
		({ command, request }) => {
			const testWindow = window as unknown as {
				__TAURI_INTERNALS__: {
					invoke(command: string, args?: unknown): Promise<unknown>;
				};
			};
			return testWindow.__TAURI_INTERNALS__.invoke(command, { request });
		},
		{ command, request },
	);
}

/** Encodes and dispatches a real `PLW1` versioned-write frame — byte-for-byte
 * the same layout `native.ts`'s own `workspaceWriteFile` produces (magic,
 * then big-endian u16 rootId/path/version lengths, a big-endian u32 content
 * length, then the four byte spans in that order). */
async function directWorkspaceWriteFile(
	page: Page,
	rootId: string,
	relativePath: string,
	expectedVersion: string,
	content: string,
): Promise<unknown> {
	return page.evaluate(
		({ rootId, relativePath, expectedVersion, content }) => {
			const encoder = new TextEncoder();
			const rootBytes = encoder.encode(rootId);
			const pathBytes = encoder.encode(relativePath);
			const versionBytes = encoder.encode(expectedVersion);
			const contentBytes = encoder.encode(content);
			const total =
				14 +
				rootBytes.length +
				pathBytes.length +
				versionBytes.length +
				contentBytes.length;
			const frame = new Uint8Array(total);
			const view = new DataView(frame.buffer);
			frame.set([0x50, 0x4c, 0x57, 0x31], 0);
			view.setUint16(4, rootBytes.length, false);
			view.setUint16(6, pathBytes.length, false);
			view.setUint16(8, versionBytes.length, false);
			view.setUint32(10, contentBytes.length, false);
			let offset = 14;
			frame.set(rootBytes, offset);
			offset += rootBytes.length;
			frame.set(pathBytes, offset);
			offset += pathBytes.length;
			frame.set(versionBytes, offset);
			offset += versionBytes.length;
			frame.set(contentBytes, offset);
			const testWindow = window as unknown as {
				__TAURI_INTERNALS__: {
					invoke(command: string, args?: unknown): Promise<unknown>;
				};
			};
			return testWindow.__TAURI_INTERNALS__.invoke(
				"workspace_write_file",
				frame,
			);
		},
		{ rootId, relativePath, expectedVersion, content },
	);
}

test("Plain: Connect to SSH Host… shows the real algorithm and fingerprint for an unknown host, connects on confirmation, and shows a connected notification", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	const consoleErrors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		false,
		{},
		{},
		{},
		{},
		[],
		0,
		0,
		null,
		{},
	);
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	await executePaletteCommandThatMayReopenAQuickInput(
		page,
		"Connect to SSH Host",
		"Plain: Connect to SSH Host…",
	);
	await fillConnectToSshHostPrompts(page, "example.com", "octocat");

	const confirmDialog = page.getByRole("dialog");
	await expect(confirmDialog).toBeVisible();
	await expect(confirmDialog).toContainText("example.com:22");
	await expect(confirmDialog).toContainText("ssh-ed25519");
	await expect(confirmDialog).toContainText("SHA256:");
	await expect(confirmDialog).toContainText(
		"not present in your own ~/.ssh/known_hosts",
	);
	await confirmDialog
		.getByRole("button", { name: "Connect", exact: true })
		.click();
	await expect(confirmDialog).toHaveCount(0);

	const toasts = page.locator(".notifications-toasts .notification-toast");
	await expect(toasts).toHaveCount(1);
	await expect(toasts.first()).toContainText(
		"connected to octocat@example.com:22",
	);

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("cancelling the SSH host-key confirmation dialog pins nothing and starts no session", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		false,
		{},
		{},
		{},
		{},
		[],
		0,
		0,
		null,
		{},
	);
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	await executePaletteCommandThatMayReopenAQuickInput(
		page,
		"Connect to SSH Host",
		"Plain: Connect to SSH Host…",
	);
	await fillConnectToSshHostPrompts(page, "example.com", "octocat");

	const confirmDialog = page.getByRole("dialog");
	await expect(confirmDialog).toBeVisible();
	await confirmDialog
		.getByRole("button", { name: "Cancel", exact: true })
		.click();
	await expect(confirmDialog).toHaveCount(0);

	// Zero pin: forgetting a host that was never pinned is idempotent, but a
	// real pin would still show up in the "Forget SSH Host Key…" picker —
	// asserting an accurate "no pinned host keys" message here is a direct,
	// user-visible proof that cancelling truly pinned nothing.
	await executePaletteCommand(
		page,
		"Forget SSH Host Key",
		"Plain: Forget SSH Host Key…",
	);
	const noHostKeysToast = page
		.locator(".notifications-toasts .notification-toast")
		.filter({ hasText: "no pinned SSH host keys" });
	await expect(noHostKeysToast).toHaveCount(1);

	// Zero session: the disconnect picker must report no live sessions.
	await executePaletteCommand(
		page,
		"Disconnect SSH Session",
		"Plain: Disconnect SSH Session…",
	);
	const noSessionsToast = page
		.locator(".notifications-toasts .notification-toast")
		.filter({ hasText: "no live SSH sessions" });
	await expect(noSessionsToast).toHaveCount(1);

	// No "connected" notification was ever shown.
	await expect(
		page
			.locator(".notifications-toasts .notification-toast")
			.filter({ hasText: "connected to" }),
	).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

test("a changed SSH host key hard-fails with both fingerprints and offers no bypass", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		false,
		{},
		{},
		{},
		{},
		[],
		0,
		0,
		null,
		{
			pinnedHostsForTest: [{ host: "example.com", port: 22 }],
			changedHostKeyTargetsForTest: ["example.com:22"],
		},
	);
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	await executePaletteCommandThatMayReopenAQuickInput(
		page,
		"Connect to SSH Host",
		"Plain: Connect to SSH Host…",
	);
	await fillConnectToSshHostPrompts(page, "example.com", "octocat");

	// A changed pinned key hard-fails immediately — never a confirmation
	// dialog with a "connect anyway" escape hatch. Scoped to
	// `.monaco-dialog-box` (the real `IDialogService.confirm` modal's own
	// class) rather than a bare `page.getByRole("dialog")`: the real error
	// notification toast this hard failure *does* legitimately show is
	// itself an ARIA `role="dialog"` element, so that broader locator would
	// also match it and prove nothing about a confirm-dialog bypass
	// specifically. Asserting zero real confirm dialogs exist at all (not
	// just that a specific button is absent from one) is the strongest
	// available proof there is no bypass affordance anywhere.
	await expect(page.locator(".monaco-dialog-box")).toHaveCount(0);

	const toasts = page.locator(".notifications-toasts .notification-toast");
	await expect(toasts).toHaveCount(1);
	const errorToastText = await toasts.first().innerText();
	expect(errorToastText).toContain("example.com:22");
	expect(errorToastText).toContain("has changed");
	expect(errorToastText).toContain("Previously pinned");
	expect(errorToastText).toContain("Now offered");
	// Two distinct fingerprints are both present (the unchanged and the
	// `changed` mock digest never collide by construction).
	const fingerprintMatches = [
		...errorToastText.matchAll(/SHA256:[A-Za-z0-9]+/g),
	];
	expect(fingerprintMatches.length).toBe(2);
	expect(fingerprintMatches[0]?.[0]).not.toBe(fingerprintMatches[1]?.[0]);

	expect(pageErrors).toEqual([]);
});

test("Plain: Disconnect SSH Session… lists the live session, disconnects it, and shows an accurate notification", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		false,
		{},
		{},
		{},
		{},
		[],
		0,
		0,
		null,
		{},
	);
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	await executePaletteCommandThatMayReopenAQuickInput(
		page,
		"Connect to SSH Host",
		"Plain: Connect to SSH Host…",
	);
	await fillConnectToSshHostPrompts(page, "example.com", "octocat");
	const confirmDialog = page.getByRole("dialog");
	await expect(confirmDialog).toBeVisible();
	await confirmDialog
		.getByRole("button", { name: "Connect", exact: true })
		.click();
	await expect(confirmDialog).toHaveCount(0);
	await expect(
		page
			.locator(".notifications-toasts .notification-toast")
			.filter({ hasText: "connected to octocat@example.com:22" }),
	).toHaveCount(1);

	await executePaletteCommandThatMayReopenAQuickInput(
		page,
		"Disconnect SSH Session",
		"Plain: Disconnect SSH Session…",
	);
	const picker = page.locator(".quick-input-widget");
	await expect(picker).toBeVisible();
	await expect(picker.locator("input")).toHaveAttribute(
		"placeholder",
		"Select an SSH session to disconnect",
	);
	const sessionItem = picker
		.locator(".quick-input-list .monaco-list-row")
		.filter({ hasText: "octocat@example.com:22" });
	await expect(sessionItem).toHaveCount(1);
	await sessionItem.click();
	await expect(picker).toBeHidden();

	await expect(
		page
			.locator(".notifications-toasts .notification-toast")
			.filter({ hasText: "disconnected from octocat@example.com:22" }),
	).toHaveCount(1);

	// A second "Disconnect SSH Session…" now reports no live sessions.
	await executePaletteCommand(
		page,
		"Disconnect SSH Session",
		"Plain: Disconnect SSH Session…",
	);
	await expect(
		page
			.locator(".notifications-toasts .notification-toast")
			.filter({ hasText: "no live SSH sessions" }),
	).toHaveCount(1);

	expect(pageErrors).toEqual([]);
});

// ---------------------------------------------------------------------
// `F220` S3 "SFTP 远程文件系统" — the remote root's own DTO surface is byte-
// for-byte the same one `installNativeIpcMock`'s fixed native root already
// serves (ADR 0007's whole point), so every one of these five scenarios
// reuses the exact same Explorer/editor interactions the local CRUD/conflict
// tests above already established; only the *entry point* (connect, then
// "Plain: Open Remote Folder…") is new.
// ---------------------------------------------------------------------

/**
 * `F220` S3B regression pin. `F220` S3's own report diagnosed a
 * `runMutation`-authorized *remote* root's non-editability as a defect
 * somewhere in `WorkspaceTopologyCoordinator.runMutation()` or
 * `@codingame/monaco-vscode-configuration-service-override`'s
 * `reinitializeWorkspace()` — reasoning that every *local* mid-session
 * root-add scenario instead goes through the native-OS-picker-backed
 * "Workspaces: Add Folder to Workspace…" built-in command. That premise was
 * wrong: `addRootFolder`'s own handler (`app/features/workspace/
 * commands.ts`) calls `topologyCoordinator.runMutation()` too — the exact
 * same function "Plain: Open Remote Folder…" calls. Both paths were always
 * identical at the coordinator level.
 *
 * The real cause was this Browser suite's own fixture: every remote-root
 * test below configured `installNativeIpcMock(page, …, "readonly", …)`.
 * `workspace_capabilities`'s mock response ties `delete`/`trash` to that
 * `mode`; `createPlainWorkspaceMutationPolicy`
 * (`app/features/workspace/file-system-provider.ts`) requires
 * `create && renameNoReplace && copyMove && delete && versionedWrite` before
 * granting `allowsMutationDispatch`, so `mode: "readonly"` makes the
 * *single, shared* `plain-workspace://` `IFileSystemProvider` (registered
 * once in `main.ts`, serving every root regardless of backend, per ADR
 * 0007's deliberately backend-opaque `rootId`) provider-wide
 * `FileSystemProviderCapabilities.Readonly`. Vendor
 * `FilesConfigurationService.isReadonly()` (`@codingame/monaco-vscode-api`'s
 * `filesConfigurationService.js`) checks that provider-wide capability
 * *before* ever consulting a specific file's own stat — so every file under
 * the scheme becomes non-editable, and Explorer's "New File…"/"New
 * Folder…" toolbar actions (gated by the same capability) stay disabled,
 * regardless of whether the root in question is local or remote, or which
 * command authorized it. In production, `workspace_capabilities()`
 * (`src-tauri/src/workspace/commands.rs`) is `WorkspaceCapabilities::
 * current_platform()` — a static, once-at-bootstrap, backend-independent
 * value — so this condition can never actually arise from adding a remote
 * root; it was purely this one fixture's own `mode` argument.
 *
 * This test proves the mechanism directly with a completely ordinary LOCAL
 * root, authorized exactly like every other local test authorizes one
 * (`File: Open Folder…` → `runMutation`; no SFTP/SSH/remote code involved
 * at all): under `mode: "readonly"` it becomes exactly as non-editable as
 * S3's report described, with the exact same two symptoms (Monaco's own
 * read-only overlay message, "New File…"/"New Folder…" toolbar disabled) —
 * proving those symptoms were never about `runMutation` or remote roots.
 */
test("a runMutation-authorized local root becomes non-editable under the exact same workspace_capabilities-driven condition S3 misattributed to remote roots", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(page, "arrayBuffer", "readonly");
	const explorer = await openNativeWorkspaceExplorer(page);
	const readme = explorer.getByRole("treeitem", {
		name: "README.md",
		exact: true,
	});
	await expect(readme).toBeVisible();

	await expect(
		page.getByRole("button", { name: "New File...", exact: true }),
	).toHaveAttribute("aria-disabled", "true");
	await expect(
		page.getByRole("button", { name: "New Folder...", exact: true }),
	).toHaveAttribute("aria-disabled", "true");

	await readme.dblclick();
	const editor = page
		.getByRole("code")
		.filter({ hasText: "Read-only Explorer fixture." });
	await expect(editor).toBeVisible();
	await page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "Read-only Explorer fixture." })
		.click();
	await page.keyboard.type("this keystroke must not land");
	await expect(page.locator(".monaco-editor-overlaymessage")).toContainText(
		"Editor is read-only because the file system of the file is read-only.",
	);
	await expect(
		page.getByRole("code").filter({ hasText: "this keystroke must not land" }),
	).toHaveCount(0);
	await expect(page.locator(".tabs-container .tab.active")).not.toHaveClass(
		/dirty/,
	);
	expect(await nativeInvocations(page, "workspace_write_file")).toHaveLength(0);

	expect(pageErrors).toEqual([]);
});

test("Plain: Open Remote Folder… browses and authorizes a live session's directory, and Explorer opens, edits and saves through the same versioned write chain", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	const consoleErrors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	// `F220` S3B: `mode: "supported"` (not S3's original `"readonly"`) — see
	// the JSDoc above the "a runMutation-authorized local root becomes
	// non-editable…" regression test just above for the full root-cause
	// writeup. In short: the single shared `plain-workspace://`
	// `IFileSystemProvider` (registered
	// once in `main.ts`, serving local and remote roots alike per ADR 0007's
	// backend-opaque `rootId`) derives its capabilities from this mock's own
	// `workspace_capabilities` response; `"readonly"` zeroes `delete`, which
	// `createPlainWorkspaceMutationPolicy` (`file-system-provider.ts`) turns
	// into a provider-wide `FileSystemProviderCapabilities.Readonly` bit that
	// `FilesConfigurationService.isReadonly()` checks before ever looking at
	// a specific file — the actual, previously-misdiagnosed cause of every
	// `runMutation`-authorized root (local or remote) rendering non-editable.
	// `"supported"` is exactly what every already-passing local mid-session
	// root-add scenario (e.g. `installMultiRootNativeIpcMock(page,
	// "supported")`) already uses.
	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"supported",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		false,
		{},
		{},
		{},
		{},
		[],
		0,
		0,
		null,
		{},
	);
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	await connectMockSshSession(page, "example.com", "octocat");
	await openRemoteFolderViaQuickPick(page, ["home", "octocat", "project"]);

	const addRootCalls = await nativeInvocations(
		page,
		"remote_workspace_add_root",
	);
	expect(addRootCalls).toHaveLength(1);
	expect(addRootCalls[0]!.args.request).toMatchObject({
		path: "/home/octocat/project",
	});

	await page.getByRole("tab", { name: /^Explorer / }).click();
	const explorer = page.getByRole("tree", { name: "Files Explorer" });
	await expect(explorer).toBeVisible();
	const mainFile = explorer.getByRole("treeitem", {
		name: "main.ts",
		exact: true,
	});
	await expect(mainFile).toBeVisible();

	// Proves the real open path (Explorer → double-click → editor render) for
	// a remote-backed file: the correct `workspace_read_file` bytes surface in
	// a real Monaco pane.
	await mainFile.dblclick();
	const editor = page
		.getByRole("code")
		.filter({ hasText: "export const remoteMain = true;" });
	await expect(editor).toBeVisible();

	const remoteRootIds = await page.evaluate(() =>
		(
			window as unknown as {
				__PLAIN_TEST_REMOTE_ROOT_IDS__(): readonly string[];
			}
		).__PLAIN_TEST_REMOTE_ROOT_IDS__(),
	);
	expect(remoteRootIds).toHaveLength(1);
	const remoteRootId = remoteRootIds[0]!;
	expect(remoteRootId).not.toBe(nativeRootId);

	// The primary path: a real keystroke and a real Ctrl+S, exactly like
	// `saveExplorerFile`'s own local-root pattern elsewhere in this file —
	// proving a `runMutation`-authorized remote root's editor is genuinely
	// writable, not just its read-only stat/readdir/readFile chain.
	const savedContent = "export const remoteMain = true; // edited\n";
	await page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "export const remoteMain = true;" })
		.click();
	await page.keyboard.press("ControlOrMeta+A");
	await page.keyboard.type(savedContent);
	const activeTab = page.locator(".tabs-container .tab.active");
	await expect(activeTab).toHaveClass(/dirty/);
	await page.keyboard.press("ControlOrMeta+S");
	await expect
		.poll(
			async () =>
				(await nativeInvocations(page, "workspace_write_file")).length,
		)
		.toBe(1);
	await expect(activeTab).not.toHaveClass(/dirty/);
	await expect(
		page.getByRole("code").filter({ hasText: "// edited" }),
	).toBeVisible();

	const write = (await nativeInvocations(page, "workspace_write_file"))[0]!
		.args;
	expect(write.request).toMatchObject({
		rootId: remoteRootId,
		relativePath: "main.ts",
	});
	expect(
		(write.request as { expectedVersion?: string }).expectedVersion,
	).toMatch(/^wv1:[0-9a-f]{64}$/);
	expect(write.contentHex).toBe(
		[...new TextEncoder().encode(savedContent)]
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join(""),
	);

	// Supplementary wire-level check (kept per `F220` S3's own precedent):
	// the real save above really did land a fresh, correctly-shaped version.
	const currentStat = (await directTauriInvoke(page, "workspace_stat", {
		rootId: remoteRootId,
		relativePath: "main.ts",
	})) as { version: string };
	expect(currentStat.version).toMatch(/^wv1:[0-9a-f]{64}$/);

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("a remote file's stale-version write is rejected exactly like the local backend rejects one", async ({
	page,
}) => {
	// `F220` S3B: real Save-driven dirty state — the primary path below —
	// now works for a `runMutation`-authorized root; see the root-cause
	// comment above the "browses and authorizes…" test just above. This
	// mirrors the local-only "shows a Reload/Save As/Details save-conflict
	// notification…" test's own dblclick→edit→external-rewrite→Ctrl+S shape
	// end to end, plus a supplementary direct wire-frame check (kept per
	// S3's own precedent) proving the backend independently enforces the
	// identical `WORKSPACE_FILE_MODIFIED` version-conflict code ADR 0007 §3
	// requires for remote.
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"supported",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		false,
		{},
		{},
		{},
		{},
		[],
		0,
		0,
		null,
		{},
	);
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	await connectMockSshSession(page, "example.com", "octocat");
	await openRemoteFolderViaQuickPick(page, ["home", "octocat", "project"]);
	await page.getByRole("tab", { name: /^Explorer / }).click();
	const explorer = page.getByRole("tree", { name: "Files Explorer" });
	const mainFile = explorer.getByRole("treeitem", {
		name: "main.ts",
		exact: true,
	});
	await expect(mainFile).toBeVisible();

	const remoteRootIds = await page.evaluate(() =>
		(
			window as unknown as {
				__PLAIN_TEST_REMOTE_ROOT_IDS__(): readonly string[];
			}
		).__PLAIN_TEST_REMOTE_ROOT_IDS__(),
	);
	expect(remoteRootIds).toHaveLength(1);
	const remoteRootId = remoteRootIds[0]!;

	// The version the model resolves and caches as its own baseline.
	const staleStat = (await directTauriInvoke(page, "workspace_stat", {
		rootId: remoteRootId,
		relativePath: "main.ts",
	})) as { version: string };
	const staleVersion = staleStat.version;

	await mainFile.dblclick();
	const editor = page
		.getByRole("code")
		.filter({ hasText: "export const remoteMain = true;" });
	await expect(editor).toBeVisible();
	await page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "export const remoteMain = true;" })
		.click();
	await page.keyboard.press("End");
	await page.keyboard.type(" // local-unsaved-edit");
	const activeTab = page.locator(".tabs-container .tab.active");
	await expect(activeTab).toHaveClass(/dirty/);

	// An external rewrite (mirrors an out-of-band SFTP-side change) bumps the
	// real version behind the open model's back; no wake is emitted, so this
	// only exercises the save-time version mismatch.
	await page.evaluate((remoteRootIdValue: string) => {
		(
			window as unknown as {
				__PLAIN_TEST_EXTERNAL_WRITE_REMOTE__(
					targetRootId: string,
					relativePath: string,
					content: string,
				): void;
			}
		).__PLAIN_TEST_EXTERNAL_WRITE_REMOTE__(
			remoteRootIdValue,
			"main.ts",
			"export const remoteMain = true; // rewritten on the server\n",
		);
	}, remoteRootId);

	await page.keyboard.press("ControlOrMeta+S");
	// Filtered rather than a bare `toHaveCount(1)`: the still-visible "Plain:
	// connected to octocat@example.com:22." info toast from
	// `connectMockSshSession` above is sticky (VS Code info notifications
	// don't auto-dismiss) and unrelated to this save-conflict assertion.
	const toast = page
		.locator(".notifications-toasts .notification-toast")
		.filter({ hasText: "Failed to save 'main.ts'" });
	await expect(toast).toHaveCount(1);
	await expect(toast).toContainText("Failed to save 'main.ts'");
	await expect(toast).toContainText(
		"Reload the file before saving again, or use Save As to preserve your edits.",
	);
	await expect(
		toast.getByRole("button", { name: "Reload", exact: true }),
	).toHaveCount(1);
	await expect(
		toast.getByRole("button", { name: "Save As...", exact: true }),
	).toHaveCount(1);
	await expect(
		toast.getByRole("button", { name: "Details", exact: true }),
	).toHaveCount(1);
	await expect(
		toast.getByRole("button", { name: "Retry", exact: true }),
	).toHaveCount(0);
	await expect(toast.getByRole("button", { name: /Overwrite/ })).toHaveCount(0);

	// Exactly like the local case: FileService's own stat-based pre-write
	// validation rejects before ever invoking the provider's write path, so
	// `workspace_write_file` is never dispatched and the model stays dirty
	// with the local edit still visible.
	expect(await nativeInvocations(page, "workspace_write_file")).toHaveLength(0);
	await expect(activeTab).toHaveClass(/dirty/);
	await expect(
		page.getByRole("code").filter({ hasText: "local-unsaved-edit" }),
	).toBeVisible();

	await toast.getByRole("button", { name: "Reload", exact: true }).click();
	await expect(toast).toHaveCount(0);
	await expect(activeTab).not.toHaveClass(/dirty/);
	await expect(
		page.getByRole("code").filter({ hasText: "rewritten on the server" }),
	).toBeVisible();
	await expect(
		page.getByRole("code").filter({ hasText: "local-unsaved-edit" }),
	).toHaveCount(0);

	// Supplementary wire-level check: the exact same stale version, raced
	// through the raw `workspace_write_file` frame instead of the UI above,
	// independently hits the identical backend guard.
	const staleWriteFrame = await page.evaluate(
		([rootId, relativePath, expectedVersion, content]) => {
			const encoder = new TextEncoder();
			const rootBytes = encoder.encode(rootId);
			const pathBytes = encoder.encode(relativePath);
			const versionBytes = encoder.encode(expectedVersion);
			const contentBytes = encoder.encode(content);
			const total =
				14 +
				rootBytes.length +
				pathBytes.length +
				versionBytes.length +
				contentBytes.length;
			const frame = new Uint8Array(total);
			const view = new DataView(frame.buffer);
			frame.set([0x50, 0x4c, 0x57, 0x31], 0);
			view.setUint16(4, rootBytes.length, false);
			view.setUint16(6, pathBytes.length, false);
			view.setUint16(8, versionBytes.length, false);
			view.setUint32(10, contentBytes.length, false);
			let offset = 14;
			frame.set(rootBytes, offset);
			offset += rootBytes.length;
			frame.set(pathBytes, offset);
			offset += pathBytes.length;
			frame.set(versionBytes, offset);
			offset += versionBytes.length;
			frame.set(contentBytes, offset);
			return [...frame];
		},
		[
			remoteRootId,
			"main.ts",
			staleVersion,
			"export const remoteMain = true; // stale wire write\n",
		],
	);
	const rejection = await page.evaluate((frameArray) => {
		const testWindow = window as unknown as {
			__TAURI_INTERNALS__: {
				invoke(command: string, args?: unknown): Promise<unknown>;
			};
		};
		return testWindow.__TAURI_INTERNALS__
			.invoke("workspace_write_file", new Uint8Array(frameArray))
			.then(
				() => ({ ok: true }),
				(error: unknown) => ({
					ok: false,
					code: (error as { code?: unknown } | undefined)?.code,
				}),
			);
	}, staleWriteFrame);
	expect(rejection).toEqual({ ok: false, code: "WORKSPACE_FILE_MODIFIED" });

	// The stale wire write never actually reached the tree — a follow-up
	// write carrying the now-current version still succeeds cleanly.
	const currentStat = (await directTauriInvoke(page, "workspace_stat", {
		rootId: remoteRootId,
		relativePath: "main.ts",
	})) as { version: string };
	expect(currentStat.version).not.toBe(staleVersion);
	const recovered = (await directWorkspaceWriteFile(
		page,
		remoteRootId,
		"main.ts",
		currentStat.version,
		"export const remoteMain = true; // recovered\n",
	)) as { status: string };
	expect(recovered.status).toBe("written");

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toHaveLength(2);
	expect(consoleErrors[0]).toContain("resulted in a save error");
	expect(consoleErrors[0]).toContain("File Modified Since");
	expect(consoleErrors[1]).toBe(
		"Failed to save 'main.ts'. Reload the file before saving again, or use Save As to preserve your edits.",
	);
});

test("create/rename/permanent-delete on a remote folder route through the same native IPC as a local root, and Refresh reveals every change in Explorer", async ({
	page,
}) => {
	// `F220` S3B: create/rename/permanent-delete now drive the real Explorer
	// toolbar/keybindings, exactly like the local multi-root "edits both
	// roots…" test's own New Folder/New File/rename/permanent-delete
	// sequence — see the root-cause comment above the "browses and
	// authorizes…" test above. A window's own real UI mutations update its
	// Explorer immediately (no watcher needed, same as a local root);
	// "Plain: Refresh Remote Folder" exists for *out-of-band* changes only,
	// which the dedicated "rescans an authorized remote root…" test below
	// already covers, so this test no longer needs it for its own edits.
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"supported",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		false,
		{},
		{},
		{},
		{},
		[],
		0,
		0,
		null,
		{},
	);
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	await connectMockSshSession(page, "example.com", "octocat");
	await openRemoteFolderViaQuickPick(page, ["home", "octocat"]);
	await page.getByRole("tab", { name: /^Explorer / }).click();
	const explorer = page.getByRole("tree", { name: "Files Explorer" });
	const scratch = explorer.getByRole("treeitem", {
		name: "scratch",
		exact: true,
	});
	await expect(scratch).toBeVisible();

	const remoteRootIds = await page.evaluate(() =>
		(
			window as unknown as {
				__PLAIN_TEST_REMOTE_ROOT_IDS__(): readonly string[];
			}
		).__PLAIN_TEST_REMOTE_ROOT_IDS__(),
	);
	expect(remoteRootIds).toHaveLength(1);
	const remoteRootId = remoteRootIds[0]!;

	await scratch.click();
	await page.keyboard.press("ArrowRight");
	await expect(scratch).toHaveAttribute("aria-expanded", "true");
	await page.getByRole("button", { name: "New File...", exact: true }).click();
	await finishExplorerNameInput(page, "note.txt");
	const note = explorer.getByRole("treeitem", {
		name: "note.txt",
		exact: true,
	});
	await expect(note).toBeVisible();

	await scratch.click();
	await pressExplorerRenameKey(page);
	await finishExplorerNameInput(page, "renamed");
	await expect(scratch).toHaveCount(0);
	const renamed = explorer.getByRole("treeitem", {
		name: "renamed",
		exact: true,
	});
	await expect(renamed).toBeVisible();
	await renamed.click();
	await page.keyboard.press("ArrowRight");
	await expect(renamed).toHaveAttribute("aria-expanded", "true");
	await expect(note).toBeVisible();

	await renamed.click();
	const confirmDeleteKey = pressExplorerPermanentDeleteKey(page);
	// `.monaco-dialog-box` rather than a bare `role=dialog`: the still-visible
	// "Plain: connected to octocat@example.com:22." notification row from
	// `connectMockSshSession` above is itself rendered with `role="dialog"`
	// too (an established gotcha elsewhere in this file), so a generic
	// `getByRole("dialog")` would match both.
	const permanentDeleteDialog = page.locator(".monaco-dialog-box");
	await expect(permanentDeleteDialog).toBeVisible();
	await expect(permanentDeleteDialog).toContainText("永久删除“renamed”？");
	await permanentDeleteDialog
		.getByRole("button", { name: "永久删除", exact: true })
		.click();
	await confirmDeleteKey;
	await expect(permanentDeleteDialog).toHaveCount(0);
	await expect(renamed).toHaveCount(0);

	const mutations = await page.evaluate(
		(commands) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(({ command }) =>
				commands.includes(command),
			);
		},
		nativeMutationCommands as readonly string[],
	);
	expect(mutations.map(({ command }) => command)).toEqual([
		"workspace_create_file",
		"workspace_rename",
		"workspace_prepare_delete",
		"workspace_begin_delete",
		"workspace_commit_delete_entry",
	]);
	expect((mutations[0]!.args.request as { rootId?: string }).rootId).toBe(
		remoteRootId,
	);
	expect((mutations[1]!.args.request as { rootId?: string }).rootId).toBe(
		remoteRootId,
	);
	expect(
		(mutations[2]!.args.request as { entries?: readonly { rootId?: string }[] })
			.entries?.[0]?.rootId,
	).toBe(remoteRootId);
	expect((mutations[4]!.args.request as { rootId?: string }).rootId).toBe(
		remoteRootId,
	);

	expect(pageErrors).toEqual([]);
});

test("Plain: Refresh Remote Folder rescans an authorized remote root and reveals a change made without any IPC", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		false,
		{},
		{},
		{},
		{},
		[],
		0,
		0,
		null,
		{},
	);
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	await connectMockSshSession(page, "example.com", "octocat");
	await openRemoteFolderViaQuickPick(page, ["home", "octocat", "project"]);
	await page.getByRole("tab", { name: /^Explorer / }).click();
	const explorer = page.getByRole("tree", { name: "Files Explorer" });
	await expect(
		explorer.getByRole("treeitem", { name: "main.ts", exact: true }),
	).toBeVisible();
	const extra = explorer.getByRole("treeitem", {
		name: "extra.rs",
		exact: true,
	});
	await expect(extra).toHaveCount(0);

	const remoteRootIds = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_REMOTE_ROOT_IDS__(): readonly string[];
		};
		return testWindow.__PLAIN_TEST_REMOTE_ROOT_IDS__();
	});
	expect(remoteRootIds).toHaveLength(1);
	await page.evaluate(
		([remoteRootId]) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_EXTERNAL_CREATE_REMOTE__(
					targetRootId: string,
					relativePath: string,
					kind: "file" | "directory",
				): void;
			};
			testWindow.__PLAIN_TEST_EXTERNAL_CREATE_REMOTE__(
				remoteRootId!,
				"extra.rs",
				"file",
			);
		},
		[remoteRootIds[0]],
	);
	// Still absent — this mock never wakes the frontend on its own; only the
	// explicit refresh command below rescans.
	await expect(extra).toHaveCount(0);

	await executePaletteCommand(
		page,
		"Refresh Remote Folder",
		"Plain: Refresh Remote Folder",
	);
	await expect(extra).toBeVisible();

	expect(pageErrors).toEqual([]);
});

test("Plain: Open Remote Folder… with no live session prompts to connect first and issues zero remote workspace IPC", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		false,
		{},
		{},
		{},
		{},
		[],
		0,
		0,
		null,
		{},
	);
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	await executePaletteCommand(
		page,
		"Open Remote Folder",
		"Plain: Open Remote Folder…",
	);
	const toasts = page.locator(".notifications-toasts .notification-toast");
	await expect(toasts).toHaveCount(1);
	await expect(toasts.first()).toContainText("connect to an SSH host first");
	await expect(page.locator(".quick-input-widget")).toBeHidden();
	expect(
		await nativeInvocations(page, "remote_workspace_pick_directory"),
	).toEqual([]);
	expect(await nativeInvocations(page, "remote_workspace_add_root")).toEqual(
		[],
	);

	expect(pageErrors).toEqual([]);
});

// --- `F220` S4: remote session lifecycle (disconnect/reconnect/Recent) -----

test("a reactively disconnected remote root fails FS operations closed, keeps dirty content, and Plain: Reconnect Remote Session… restores it", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"supported",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		false,
		{},
		{},
		{},
		{},
		[],
		0,
		0,
		null,
		{},
	);
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	await connectMockSshSession(page, "example.com", "octocat");
	await openRemoteFolderViaQuickPick(page, ["home", "octocat", "project"]);

	const remoteRootIds = await page.evaluate(() =>
		(
			window as unknown as {
				__PLAIN_TEST_REMOTE_ROOT_IDS__(): readonly string[];
			}
		).__PLAIN_TEST_REMOTE_ROOT_IDS__(),
	);
	expect(remoteRootIds).toHaveLength(1);
	const remoteRootId = remoteRootIds[0]!;

	const sessionState = (await directTauriInvoke(
		page,
		"remote_session_state",
		{},
	)) as { sessions: readonly { sessionId: string }[] };
	expect(sessionState.sessions).toHaveLength(1);
	const sessionId = sessionState.sessions[0]!.sessionId;

	await page.getByRole("tab", { name: /^Explorer / }).click();
	const explorer = page.getByRole("tree", { name: "Files Explorer" });
	const mainFile = explorer.getByRole("treeitem", {
		name: "main.ts",
		exact: true,
	});
	await expect(mainFile).toBeVisible();
	await mainFile.dblclick();
	const editor = page
		.getByRole("code")
		.filter({ hasText: "export const remoteMain = true;" });
	await expect(editor).toBeVisible();

	// A real dirty edit, left unsaved — must survive both the disconnect and
	// the later failed save attempt untouched.
	await page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "export const remoteMain = true;" })
		.click();
	await page.keyboard.press("End");
	await page.keyboard.type(" // still-dirty-after-disconnect");
	const activeTab = page.locator(".tabs-container .tab.active");
	await expect(activeTab).toHaveClass(/dirty/);

	// Simulates the peer hanging up on its own — the reactive counterpart to
	// an explicit "Plain: Disconnect SSH Session…", with no wire command a
	// test could otherwise call to reach it.
	await page.evaluate((sessionIdValue: string) => {
		(
			window as unknown as {
				__PLAIN_TEST_SIMULATE_REMOTE_TRANSPORT_CLOSED__(
					sessionId: string,
				): void;
			}
		).__PLAIN_TEST_SIMULATE_REMOTE_TRANSPORT_CLOSED__(sessionIdValue);
	}, sessionId);

	// An actionable, root-naming notification — distinct from the generic
	// "disconnected from user@host:port" toast `plain-remote-ssh-commands.ts`
	// already renders for every session event (both remain visible; they are
	// not deduplicated).
	const toasts = page.locator(".notifications-toasts .notification-toast");
	const lostConnectionToast = toasts.filter({
		hasText: "lost the SSH connection",
	});
	await expect(lostConnectionToast).toHaveCount(1);
	await expect(lostConnectionToast).toContainText("project");
	await expect(lostConnectionToast).toContainText("octocat@example.com:22");
	await expect(lostConnectionToast).toContainText(
		"Plain: Reconnect Remote Session…",
	);

	// `NotificationsToasts.MAX_NOTIFICATIONS` caps simultaneously visible
	// toasts at 3 — already reached above (connected/disconnected/lost-
	// connection) — so the save-error notification below needs a slot
	// cleared for it first, or it queues invisibly.
	await clearAllToasts(page);

	// A real FS operation against the now-disconnected root fails closed —
	// the dirty content is neither cleared nor silently discarded. The
	// message itself is Plain's own shared "plain-workspace://" save-error
	// text (identical wording for every save failure on this scheme,
	// including an ordinary version conflict elsewhere in this file) —
	// `REMOTE_SESSION_DISCONNECTED`'s own accurate detail is what a real
	// user already saw in the actionable notification above; what matters
	// here is that the failure is surfaced at all and nothing is silently
	// dropped.
	await page.keyboard.press("ControlOrMeta+S");
	const saveFailedToast = page
		.locator('[role="alert"], .notifications-toasts .notification-toast')
		.filter({ hasText: "Failed to save 'main.ts'" });
	await expect(saveFailedToast.first()).toBeVisible();
	await expect(activeTab).toHaveClass(/dirty/);
	await expect(
		page
			.getByRole("code")
			.filter({ hasText: "// still-dirty-after-disconnect" }),
	).toBeVisible();
	// Save on the `plain-workspace://` scheme is optimistic-concurrency: the
	// vendored, patched `FileService.writeFile()` always stats the resource
	// first (to verify its cached version against the live one) *before*
	// ever calling the provider's `plainWriteFile` — see
	// `validateWriteFile` in `patches/@codingame__monaco-vscode-files-service-override@35.0.1.patch`.
	// That pre-flight `workspace_stat` is what actually fails closed here
	// (`treeForRootId`'s session-liveness check, same as every other FS op
	// against this disconnected root); the real `workspace_write_file`
	// command is never reached at all — confirmed by instrumenting both the
	// provider and the vendored file service directly rather than assumed.
	// The dirty tab/unchanged content assertions above are what prove the
	// save did not actually succeed.
	expect(await nativeInvocations(page, "workspace_write_file")).toEqual([]);
	expect(
		(await nativeInvocations(page, "workspace_stat")).some(
			(call) =>
				(call.args as { request?: { relativePath?: string } }).request
					?.relativePath === "main.ts",
		),
	).toBe(true);

	// Bypasses IPC entirely (mirrors the existing "Refresh Remote Folder"
	// test's own technique) — proves the reconnect below really does drive a
	// fresh Explorer read, not a stale cache.
	await page.evaluate((targetRootId: string) => {
		(
			window as unknown as {
				__PLAIN_TEST_EXTERNAL_CREATE_REMOTE__(
					targetRootId: string,
					relativePath: string,
					kind: "file" | "directory",
				): void;
			}
		).__PLAIN_TEST_EXTERNAL_CREATE_REMOTE__(targetRootId, "extra.rs", "file");
	}, remoteRootId);

	await executePaletteCommandThatMayReopenAQuickInput(
		page,
		"Reconnect Remote Session",
		"Plain: Reconnect Remote Session…",
	);
	const reconnectPicker = page.locator(".quick-input-widget");
	await expect(reconnectPicker).toBeVisible();
	await expect(reconnectPicker.locator("input")).toHaveAttribute(
		"placeholder",
		"Select a remote folder to reconnect",
	);
	const candidateRow = reconnectPicker
		.locator(".quick-input-list .monaco-list-row")
		.filter({ hasText: "project" });
	await expect(candidateRow).toHaveCount(1);
	await expect(candidateRow).toContainText("octocat@example.com:22");
	await candidateRow.click();
	await expect(reconnectPicker).toBeHidden();

	// The host key was already pinned by the first connect above, and its
	// live fingerprint has not changed — `remote_session_connect` resolves
	// straight to `"connected"` this time, no confirmation dialog.
	await expect(page.locator(".monaco-dialog-box")).toHaveCount(0);

	const successToast = toasts.filter({ hasText: "reconnected" });
	await expect(successToast).toHaveCount(1);
	await expect(successToast).toContainText("project");
	await expect(successToast).toContainText("octocat@example.com:22");

	const reconnectCalls = await nativeInvocations(
		page,
		"remote_workspace_reconnect_root",
	);
	expect(reconnectCalls).toHaveLength(1);
	expect(reconnectCalls[0]!.args.request).toMatchObject({
		rootId: remoteRootId,
	});

	// Explorer really did refresh (not a stale cache) — the entry created
	// directly against the mock's tree while disconnected is now visible.
	await expect(
		explorer.getByRole("treeitem", { name: "extra.rs", exact: true }),
	).toBeVisible();

	// A bare Ctrl+S retry does *not* magically start succeeding the moment
	// the root reconnects: this app's own vendored, patched
	// `StoredFileWorkingCopy.save()`/`doSave()` (`storedFileWorkingCopy.js`)
	// sets `plainSaveRequiresReload = true` on *any* `plain-workspace://`
	// save failure and then refuses every further save attempt outright —
	// no stat, no write, nothing dispatched at all — until the model is
	// either reloaded (which discards the dirty buffer, exactly like this
	// file's own pre-existing "a remote file's stale-version write is
	// rejected…" test demonstrates via its "Reload" button) or written via
	// "Save As…". This is the *same* toast/mechanism that test already
	// exercises, not something reconnecting changes or should change —
	// confirmed by instrumenting the provider and the vendored file service
	// directly rather than assumed. A retry here is therefore expected to
	// remain a complete no-op, and the dirty local edit is still visible,
	// proving nothing was silently discarded either.
	await page.keyboard.press("ControlOrMeta+S");
	await page.waitForTimeout(300);
	expect(await nativeInvocations(page, "workspace_write_file")).toEqual([]);
	await expect(activeTab).toHaveClass(/dirty/);
	await expect(
		page
			.getByRole("code")
			.filter({ hasText: "// still-dirty-after-disconnect" }),
	).toBeVisible();

	// What reconnecting *does* restore is the FS capability itself, exactly
	// like every other operation against this root above (Explorer refresh,
	// etc.) — proven the same way the pre-existing stale-version-conflict
	// test proves its own equivalent recovery: a direct wire-level write
	// carrying the dirty editor's own unsaved content now succeeds, where
	// the same call against the still-disconnected session earlier in this
	// test would have failed with `REMOTE_SESSION_DISCONNECTED`.
	const liveStat = (await directTauriInvoke(page, "workspace_stat", {
		rootId: remoteRootId,
		relativePath: "main.ts",
	})) as { version: string };
	const recovered = (await directWorkspaceWriteFile(
		page,
		remoteRootId,
		"main.ts",
		liveStat.version,
		"export const remoteMain = true; // still-dirty-after-disconnect\n",
	)) as { status: string };
	expect(recovered.status).toBe("written");

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toHaveLength(2);
	expect(consoleErrors[0]).toContain("resulted in a save error");
	expect(consoleErrors[1]).toBe(
		"Failed to save 'main.ts'. Reload the file before saving again, or use Save As to preserve your edits.",
	);
});

test("cold start restores the local root automatically and surfaces a remote root as needing reconnect, whose backup is restored once reconnected", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	// Pre-pinned: represents a host this window already trusted in an
	// earlier session — Plain's own known-hosts pin store genuinely persists
	// across restarts in production (ADR 0006 §3), unlike this mock's own
	// in-memory `remoteKnownHosts`, which does not survive a `page.reload()`
	// (a fresh `addInitScript` run). Isolates this scenario's own new
	// behavior (cold-start Recent/backup restoration) from the host-key
	// confirmation dialog flow itself, already covered by this file's own
	// S1 tests and this file's own "selecting a Recent entry…" test below.
	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"supported",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		false,
		{},
		{},
		{},
		{},
		[],
		0,
		0,
		null,
		{ pinnedHostsForTest: [{ host: "example.com", port: 22 }] },
	);
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	await executePaletteCommand(page, "Open Folder", "File: Open Folder...");
	await page.getByRole("tab", { name: /^Explorer / }).click();
	const explorer = page.getByRole("tree", { name: "Files Explorer" });
	await expect(
		explorer.getByRole("treeitem", { name: "README.md", exact: true }),
	).toBeVisible();

	// Not `connectMockSshSession`: that helper unconditionally expects a
	// host-key confirmation dialog, but this host is pre-pinned above
	// (representing an already-trusted identity from an earlier session), so
	// `remote_session_connect` resolves straight to `"connected"` — no
	// dialog to confirm.
	await executePaletteCommandThatMayReopenAQuickInput(
		page,
		"Connect to SSH Host",
		"Plain: Connect to SSH Host…",
	);
	await fillConnectToSshHostPrompts(page, "example.com", "octocat");
	await expect(page.locator(".monaco-dialog-box")).toHaveCount(0);
	await expect
		.poll(
			async () =>
				(await nativeInvocations(page, "remote_session_connect")).length,
		)
		.toBe(1);

	await openRemoteFolderViaQuickPick(page, ["home", "octocat", "project"]);
	const firstRemoteRootIds = await page.evaluate(() =>
		(
			window as unknown as {
				__PLAIN_TEST_REMOTE_ROOT_IDS__(): readonly string[];
			}
		).__PLAIN_TEST_REMOTE_ROOT_IDS__(),
	);
	expect(firstRemoteRootIds).toHaveLength(1);
	const originalRemoteRootId = firstRemoteRootIds[0]!;

	const mainFile = explorer.getByRole("treeitem", {
		name: "main.ts",
		exact: true,
	});
	await expect(mainFile).toBeVisible();
	await mainFile.dblclick();
	const editor = page
		.getByRole("code")
		.filter({ hasText: "export const remoteMain = true;" });
	await expect(editor).toBeVisible();
	await page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "export const remoteMain = true;" })
		.click();
	await page.keyboard.press("End");
	await page.keyboard.type(" // unsaved-before-cold-start");
	const activeTab = page.locator(".tabs-container .tab.active");
	await expect(activeTab).toHaveClass(/dirty/);

	// Waits for the real hot-exit backup to actually land on the
	// (sessionStorage-backed) mock store, mirroring the existing local-root
	// hot-exit test's own identical wait for the same 1000ms default backup
	// schedule delay.
	await expect
		.poll(async () => (await nativeInvocations(page, "backup_write")).length, {
			timeout: 5_000,
		})
		.toBe(1);
	const backupWriteCall = (await nativeInvocations(page, "backup_write"))[0]!;
	expect((backupWriteCall.args as { rootId?: string }).rootId).toBe(
		originalRemoteRootId,
	);

	// Simulate the next cold start: reload re-runs this fixture's
	// `addInitScript` from scratch — the live SSH session and the authorized
	// remote root are both genuinely gone — but the Recent store and the
	// backup store both round-trip through `sessionStorage`, which the
	// reload itself preserves.
	await page.reload();
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	// The local root restores on its own — no "File: Open Folder..." here.
	// Also deliberately no `.click()` on the Explorer tab: the workbench's
	// own layout state (sidebar visibility + last-active viewlet) survives
	// a `page.reload()` independently of this fixture's own `sessionStorage`
	// round-tripping (VS Code persists it separately), so Explorer is
	// already the open, selected view by the time `data-plain-ready` flips
	// — clicking its already-active activity-bar tab again would only
	// toggle the sidebar shut, exactly like this file's own pre-existing
	// reload-and-check-restored-state tests never re-click it either.
	await expect(explorer).toBeVisible();
	await expect(
		explorer.getByRole("treeitem", { name: "README.md", exact: true }),
	).toBeVisible();

	// An accurate, actionable notice naming the exact root/host — never a
	// bare "disconnected" — and zero remote IPC of any kind until the user
	// explicitly reconnects.
	const toasts = page.locator(".notifications-toasts .notification-toast");
	const needsReconnectToast = toasts.filter({ hasText: "needs to reconnect" });
	await expect(needsReconnectToast).toHaveCount(1);
	await expect(needsReconnectToast).toContainText("project");
	await expect(needsReconnectToast).toContainText("octocat@example.com:22");
	await expect(needsReconnectToast).toContainText(
		"Plain: Reconnect Remote Session…",
	);
	expect(await nativeInvocations(page, "remote_session_connect")).toEqual([]);
	expect(await nativeInvocations(page, "remote_workspace_add_root")).toEqual(
		[],
	);

	await executePaletteCommandThatMayReopenAQuickInput(
		page,
		"Reconnect Remote Session",
		"Plain: Reconnect Remote Session…",
	);
	const reconnectPicker = page.locator(".quick-input-widget");
	await expect(reconnectPicker).toBeVisible();
	const candidateRow = reconnectPicker
		.locator(".quick-input-list .monaco-list-row")
		.filter({ hasText: "project" });
	await expect(candidateRow).toHaveCount(1);
	await candidateRow.click();
	await expect(reconnectPicker).toBeHidden();

	// Pre-pinned "from an earlier session", unchanged fingerprint — connects
	// straight through, no dialog.
	await expect(page.locator(".monaco-dialog-box")).toHaveCount(0);

	await expect
		.poll(
			async () =>
				(await nativeInvocations(page, "remote_workspace_add_root")).length,
		)
		.toBe(1);

	const secondRemoteRootIds = await page.evaluate(() =>
		(
			window as unknown as {
				__PLAIN_TEST_REMOTE_ROOT_IDS__(): readonly string[];
			}
		).__PLAIN_TEST_REMOTE_ROOT_IDS__(),
	);
	expect(secondRemoteRootIds).toHaveLength(1);
	// This fixture's remote-root id counter restarts at the same initial
	// value on every fresh `addInitScript` run, and this test authorizes
	// exactly one remote root per session, so the freshly re-authorized root
	// really does land under the exact same identity the backup above was
	// originally written against — verified explicitly here rather than
	// silently assumed.
	expect(secondRemoteRootIds[0]).toBe(originalRemoteRootId);

	// The dirty content from before the cold start is restored.
	const restoredTab = page.locator(".tabs-container .tab", {
		hasText: "main.ts",
	});
	await expect(restoredTab).toBeVisible();
	await expect(restoredTab).toHaveClass(/dirty/);
	await expect(
		page.getByRole("code").filter({
			hasText: "export const remoteMain = true; // unsaved-before-cold-start",
		}),
	).toBeVisible();

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("selecting a Recent entry with a remote root drives a real connect (through host-key confirmation) then authorization", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"supported",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		false,
		{},
		{},
		{},
		{},
		[],
		0,
		0,
		null,
		{},
	);
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	// `F220` S4's own addition to `remote_workspace_add_root` (records into
	// Recent) is what produces this entry — no separate seeding mechanism.
	await connectMockSshSession(page, "example.com", "octocat");
	await openRemoteFolderViaQuickPick(page, ["home", "octocat", "project"]);
	const firstRemoteRootIds = await page.evaluate(() =>
		(
			window as unknown as {
				__PLAIN_TEST_REMOTE_ROOT_IDS__(): readonly string[];
			}
		).__PLAIN_TEST_REMOTE_ROOT_IDS__(),
	);
	expect(firstRemoteRootIds).toHaveLength(1);

	// Unpins the host — simulating a genuinely fresh trust decision still
	// being required by the time this Recent entry is reopened, so the
	// Recent-driven connect below exercises the real "unknown host"
	// confirmation dialog end to end, not a shortcut.
	await executePaletteCommandThatMayReopenAQuickInput(
		page,
		"Forget SSH Host Key",
		"Plain: Forget SSH Host Key…",
	);
	const forgetPicker = page.locator(".quick-input-widget");
	await expect(forgetPicker).toBeVisible();
	await forgetPicker
		.locator(".quick-input-list .monaco-list-row")
		.filter({ hasText: "example.com:22" })
		.click();
	const forgetConfirmDialog = page.locator(".monaco-dialog-box");
	await expect(forgetConfirmDialog).toBeVisible();
	await forgetConfirmDialog
		.getByRole("button", { name: "Forget Host Key", exact: true })
		.click();
	await expect(forgetConfirmDialog).toHaveCount(0);
	expect(await nativeInvocations(page, "remote_host_key_forget")).toHaveLength(
		1,
	);

	// Not the strict `executePaletteCommand`: selecting a Recent entry that
	// carries a remote root immediately reopens a fresh quick input (the
	// host-key confirmation flow below), so the palette's own quick input
	// never durably hides the way that stricter helper expects.
	await executePaletteCommandThatMayReopenAQuickInput(
		page,
		"Open Recent",
		"File: Open Recent...",
	);
	const recentPicker = page.locator(".quick-input-widget");
	await expect(recentPicker.locator("input")).toHaveAttribute(
		"placeholder",
		"Select a recent workspace to open",
	);
	const recentRow = recentPicker
		.locator(".quick-input-list .monaco-list-row")
		.filter({ hasText: "project" });
	await expect(recentRow).toHaveCount(1);
	await expect(recentPicker).not.toContainText("/home/octocat");
	await recentRow.click();

	// A real host-key confirmation dialog — the host was just forgotten
	// above, so this is genuinely unknown again, not silently skipped or
	// failed outright. `.monaco-dialog-box` (not a bare `role=dialog`): a
	// "Plain: connected to…" toast from the very first connect above is
	// still visible and itself carries `role="dialog"` too — an established
	// gotcha elsewhere in this file.
	const confirmDialog = page.locator(".monaco-dialog-box");
	await expect(confirmDialog).toBeVisible();
	await expect(confirmDialog).toContainText("example.com:22");
	await expect(confirmDialog).toContainText("has not been seen before");
	await confirmDialog
		.getByRole("button", { name: "Connect", exact: true })
		.click();
	await expect(confirmDialog).toHaveCount(0);

	await expect
		.poll(
			async () =>
				(await nativeInvocations(page, "remote_session_connect")).length,
		)
		.toBe(2);
	// Cumulative for the whole test, not just this second connect: the very
	// first `connectMockSshSession` above also confirmed an unknown host once
	// (unpinned in this test's `installNativeIpcMock` call), and forgetting
	// the key made it unknown again for this Recent-driven reconnect — two
	// genuinely separate "unknown host" confirmations in total, one per
	// connect.
	expect(await nativeInvocations(page, "remote_host_key_confirm")).toHaveLength(
		2,
	);
	await expect
		.poll(
			async () =>
				(await nativeInvocations(page, "remote_workspace_add_root")).length,
		)
		.toBe(2);

	const secondRemoteRootIds = await page.evaluate(() =>
		(
			window as unknown as {
				__PLAIN_TEST_REMOTE_ROOT_IDS__(): readonly string[];
			}
		).__PLAIN_TEST_REMOTE_ROOT_IDS__(),
	);
	// A genuinely new SSH session (the first one was never disconnected) and
	// a genuinely new `remote_workspace_add_root` call together mint a
	// second, distinct root id — the same directory is now authorized twice
	// under two different live sessions, not silently reused.
	expect(secondRemoteRootIds).toHaveLength(2);

	expect(pageErrors).toEqual([]);
});

test("a host key that changed since the original connect hard-fails Plain: Reconnect Remote Session… with no bypass, leaving the root disconnected", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"supported",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		false,
		{},
		{},
		{},
		{},
		[],
		0,
		0,
		null,
		{},
	);
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);

	await connectMockSshSession(page, "example.com", "octocat");
	await openRemoteFolderViaQuickPick(page, ["home", "octocat", "project"]);

	const sessionState = (await directTauriInvoke(
		page,
		"remote_session_state",
		{},
	)) as { sessions: readonly { sessionId: string }[] };
	expect(sessionState.sessions).toHaveLength(1);
	const sessionId = sessionState.sessions[0]!.sessionId;
	await page.evaluate((sessionIdValue: string) => {
		(
			window as unknown as {
				__PLAIN_TEST_SIMULATE_REMOTE_TRANSPORT_CLOSED__(
					sessionId: string,
				): void;
			}
		).__PLAIN_TEST_SIMULATE_REMOTE_TRANSPORT_CLOSED__(sessionIdValue);
	}, sessionId);

	// Simulates the host being reinstalled while this root sat disconnected
	// — mirrors this file's own existing S1 "a changed SSH host key
	// hard-fails…" test's construction (`pinnedHostsForTest` +
	// `changedHostKeyTargetsForTest`), except triggered at runtime instead
	// of from the very first connect, since a real root must already be
	// authorized before this scenario even applies.
	await page.evaluate(() => {
		(
			window as unknown as {
				__PLAIN_TEST_MARK_HOST_KEY_CHANGED__(host: string, port: number): void;
			}
		).__PLAIN_TEST_MARK_HOST_KEY_CHANGED__("example.com", 22);
	});

	await executePaletteCommandThatMayReopenAQuickInput(
		page,
		"Reconnect Remote Session",
		"Plain: Reconnect Remote Session…",
	);
	const picker = page.locator(".quick-input-widget");
	await expect(picker).toBeVisible();
	const candidateRow = picker
		.locator(".quick-input-list .monaco-list-row")
		.filter({ hasText: "project" });
	await expect(candidateRow).toHaveCount(1);
	await candidateRow.click();
	await expect(picker).toBeHidden();

	// A changed pinned key hard-fails immediately — never a confirmation
	// dialog with a "connect anyway" escape hatch. `.monaco-dialog-box`
	// (not a bare `role=dialog`): the real error notification toast this
	// hard failure does legitimately show is itself `role="dialog"` too.
	await expect(page.locator(".monaco-dialog-box")).toHaveCount(0);

	// Read the failure back from the Notification *Center* (`.notify()`'s
	// own `NotificationsModel`), not the transient toast stack: the connect
	// toast plus the two disconnect notifications already on screen
	// (the generic one from `plain-remote-ssh-commands.ts` and the
	// actionable one from `handleRemoteSessionEventForWorkspaceLifecycle`)
	// fill VS Code's real `NotificationsToasts.MAX_NOTIFICATIONS = 3`, so
	// this hard-failure notification legitimately queues without ever
	// rendering as a 4th toast — confirmed directly by instrumenting
	// `NotificationsModel.addNotification` (it *is* added to the model;
	// the toast area's own cap is what hides it). The Center lists every
	// notification in the model regardless of that cap, so it is the
	// correct place to assert this failure was actually surfaced rather
	// than silently dropped.
	await page.getByRole("button", { name: "Notifications" }).click();
	const notificationsCenter = page.locator(".notifications-center");
	await expect(notificationsCenter).toBeVisible();
	const errorItem = notificationsCenter
		.locator(".notification-list-item")
		.filter({ hasText: "has changed" });
	await expect(errorItem).toHaveCount(1);
	const errorText = await errorItem.first().innerText();
	expect(errorText).toContain("example.com:22");
	expect(errorText).toContain("Previously pinned");
	expect(errorText).toContain("Now offered");
	const fingerprintMatches = [...errorText.matchAll(/SHA256:[A-Za-z0-9]+/g)];
	expect(fingerprintMatches.length).toBe(2);
	expect(fingerprintMatches[0]?.[0]).not.toBe(fingerprintMatches[1]?.[0]);
	await page.keyboard.press("Escape");
	await expect(notificationsCenter).toBeHidden();

	// The connect phase failed before ever reaching the root-level reconnect
	// — no silent success, and the root is left exactly as disconnected as
	// it was.
	expect(
		await nativeInvocations(page, "remote_workspace_reconnect_root"),
	).toEqual([]);

	// Re-running the command still offers the same root as needing
	// reconnection — it was never marked reconnected.
	await executePaletteCommandThatMayReopenAQuickInput(
		page,
		"Reconnect Remote Session",
		"Plain: Reconnect Remote Session…",
	);
	await expect(picker).toBeVisible();
	await expect(
		picker
			.locator(".quick-input-list .monaco-list-row")
			.filter({ hasText: "project" }),
	).toHaveCount(1);
	await page.keyboard.press("Escape");
	await expect(picker).toBeHidden();

	expect(pageErrors).toEqual([]);
});

// ---------------------------------------------------------------------
// `F220` S5 — remote terminal (`pty-req`/`shell` channel). Every scenario
// here opens both the fixed native root *and* one mock remote root in the
// same window (mirrors the real "mixed local+remote workspace" shape
// `terminal::service::service::tests::remote_tests`'s own `RemoteHarness`
// doc comment records as this slice's own known trust-identity scope
// boundary), then drives the terminal view's root selector to the remote
// root before creating a terminal.
// ---------------------------------------------------------------------

/** Opens the fixed native root, connects a mock SSH session, authorizes one
 * remote root through it, and returns that remote root's own `rootId` (read
 * back off the terminal view's own root `<select>`, the only place this
 * mock's dynamically-issued remote root id is otherwise observable from the
 * test side). `terminalTrustedForTest: true` — every scenario below starts
 * at least one terminal. */
async function openMixedLocalAndRemoteWorkspaceForTerminal(
	page: Page,
): Promise<string> {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await connectMockSshSession(page, "example.com", "octocat");
	await openRemoteFolderViaQuickPick(page, ["home", "octocat", "project"]);

	await createTerminal(page);
	const selector = page.getByRole("combobox", {
		name: "New Terminal Working Folder",
	});
	await expect(selector).toBeEnabled();
	const optionValues = await selector
		.locator("option")
		.evaluateAll((options) =>
			options.map((option) => (option as HTMLOptionElement).value),
		);
	const remoteRootId = optionValues.find(
		(value) => value.length > 0 && value !== nativeRootId,
	);
	if (remoteRootId === undefined) {
		throw new Error(
			"expected the root selector to list the newly authorized remote root",
		);
	}

	expect(pageErrors).toEqual([]);
	return remoteRootId;
}

test("F220 S5: creates a remote terminal, renders scripted output, echoes typed input, and starts with the audited fixed request shape", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	const remoteRootId = await openMixedLocalAndRemoteWorkspaceForTerminal(page);

	// Configure a *non-default* profile/cwd first, while the root selection
	// is still ambiguous (so both controls are enabled) — proves the
	// remote terminal created below genuinely *forces*
	// `REMOTE_TERMINAL_FUTURE_TAB_DEFAULTS` rather than merely coinciding
	// with the ordinary unconfigured fallback (which happens to be the same
	// `systemDefault`/`null` values, so a terminal created against a never-
	// touched configuration would not actually distinguish the two).
	const profileSelect = page.getByRole("combobox", {
		name: "Default Terminal Profile",
	});
	await profileSelect.selectOption("zsh");
	const cwdInput = page.getByRole("textbox", {
		name: "Default Terminal Working Directory",
	});
	await cwdInput.fill("nested/project");
	await cwdInput.blur();

	// `openMixedLocalAndRemoteWorkspaceForTerminal` already ran "Plain:
	// Create Terminal" once while the root selection was still ambiguous
	// (two roots, none explicitly chosen), which left the view pending a
	// root pick (mirrors "Terminal requires an explicit root in a
	// multi-root workspace…"'s own identical pattern) — selecting the
	// remote root here is what actually starts the one terminal this test
	// exercises.
	const selector = page.getByRole("combobox", {
		name: "New Terminal Working Folder",
	});
	await selector.selectOption(remoteRootId);

	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(1);
	const [startCall] = await terminalCallsFor(page, "terminal_start");
	expect(startCall?.args.request).toMatchObject({
		rootId: remoteRootId,
		// `F220` S5: the frontend always forces these two exact values for a
		// remote root, *despite* the "zsh"/"nested/project" configuration
		// just persisted above — see `REMOTE_TERMINAL_FUTURE_TAB_DEFAULTS`'s
		// own doc comment; `terminal::service::TerminalService::start_remote`
		// fails closed on anything else.
		profileId: "systemDefault",
		cwd: null,
	});

	const surface = page.locator(".plain-terminal-surface");
	await expect(surface).toBeVisible();

	await pushTerminalOutput(page, "remote shell ready");
	await expect(page.locator(".plain-terminal-grid")).toContainText(
		"remote shell ready",
	);

	const input = page.locator(".plain-terminal-input");
	await input.focus();
	await page.keyboard.type("echo");
	await expect
		.poll(
			async () =>
				(await terminalCallsFor(page, "terminal_input_key")).filter(
					({ args }) =>
						typeof args.request === "object" &&
						args.request !== null &&
						typeof (args.request as { utf8?: unknown }).utf8 === "string",
				).length,
		)
		.toBeGreaterThanOrEqual(4);
	await expect(page.locator(".plain-terminal-grid")).toContainText(
		"remote shell readyecho",
	);

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("F220 S5: the profile and cwd controls are disabled with an explanatory tooltip for a remote root, and re-enabled back to normal for the native root", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	const remoteRootId = await openMixedLocalAndRemoteWorkspaceForTerminal(page);
	const selector = page.getByRole("combobox", {
		name: "New Terminal Working Folder",
	});
	const profileSelect = page.getByRole("combobox", {
		name: "Default Terminal Profile",
	});
	const cwdInput = page.getByRole("textbox", {
		name: "Default Terminal Working Directory",
	});

	// Selecting the remote root disables both controls and shows the fixed
	// remote profile label — never the live-fetched local profile list.
	await selector.selectOption(remoteRootId);
	await expect(profileSelect).toBeDisabled();
	await expect(profileSelect).toHaveValue("systemDefault");
	await expect(profileSelect.locator("option")).toHaveCount(1);
	await expect(profileSelect.locator("option")).toHaveText(
		"Remote default shell",
	);
	await expect(cwdInput).toBeDisabled();

	// Switching back to the native root restores the ordinary, enabled
	// local-profile-list behavior.
	await selector.selectOption(nativeRootId);
	await expect(profileSelect).toBeEnabled();
	await expect(cwdInput).toBeEnabled();
	const localOptionCount = await profileSelect.locator("option").count();
	expect(localOptionCount).toBeGreaterThan(1);

	// And selecting the remote root again disables them again — this is a
	// live, reversible reflection of the current selection, not a one-time
	// decision.
	await selector.selectOption(remoteRootId);
	await expect(profileSelect).toBeDisabled();
	await expect(cwdInput).toBeDisabled();

	expect(pageErrors).toEqual([]);
});

test("F220 S5: a real remote exit-status shows the ordinary accurate banner, and a session-level disconnect shows a distinct, never-disguised-as-normal banner with input inert afterward", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	const remoteRootId = await openMixedLocalAndRemoteWorkspaceForTerminal(page);
	const selector = page.getByRole("combobox", {
		name: "New Terminal Working Folder",
	});
	// Selecting the remote root here is what actually starts the terminal —
	// see `openMixedLocalAndRemoteWorkspaceForTerminal`'s own doc comment for
	// why the view is already pending a root pick at this point.
	await selector.selectOption(remoteRootId);
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(1);

	const activePane = page.locator('.plain-terminal-pane[data-active="true"]');
	await emitTerminalProcessExit(page, 0);
	await expect(activePane).toHaveAttribute("data-terminal-exited", "true");
	await expect(activePane).toHaveAttribute("data-terminal-exit-code", "0");
	await expect(activePane).not.toHaveAttribute("data-terminal-exit-signal");
	await expect(activePane.locator(".plain-terminal-status")).toHaveText(
		"The shell process exited with code 0. This session has ended and cannot be resumed — close this pane when you are done with it.",
	);

	// A second remote pane, ended by a session-level disconnect instead of a
	// real remote exit-status/exit-signal — `terminal::service`'s own
	// `REMOTE_TERMINAL_DISCONNECTED_SIGNAL` — must render as a distinct,
	// non-`null`-signal (never-a-normal-exit) banner, exactly like a real
	// signal-terminated local process would.
	await page.getByRole("button", { name: "Split Terminal Right" }).click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBeGreaterThanOrEqual(2);
	const secondActivePane = page.locator(
		'.plain-terminal-pane[data-active="true"]',
	);
	await emitTerminalProcessExit(page, 1, "SSH session disconnected");
	await expect(secondActivePane).toHaveAttribute(
		"data-terminal-exit-signal",
		"SSH session disconnected",
	);
	const disconnectStatus = secondActivePane.locator(".plain-terminal-status");
	await expect(disconnectStatus).toHaveText(
		"The shell process was terminated (SSH session disconnected). This session has ended and cannot be resumed — close this pane when you are done with it.",
	);
	expect(await disconnectStatus.innerText()).not.toContain("exited with code");

	// Input into the now-disconnected pane is inert — no further
	// `terminal_input_key`, and (the real point) no unhandled-rejection
	// `pageerror` from writing to a session nothing reads from anymore.
	const inputKeyCallsBeforeTyping = (
		await terminalCallsFor(page, "terminal_input_key")
	).length;
	await secondActivePane.locator(".plain-terminal-input").focus();
	await page.keyboard.type("still typing after disconnect");
	expect((await terminalCallsFor(page, "terminal_input_key")).length).toBe(
		inputKeyCallsBeforeTyping,
	);

	expect(pageErrors).toEqual([]);
});

test("F220 S5: local terminal creation, echo, and exit banners are unaffected by the remote-terminal routing added to the same mock", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
	);
	await openNativeWorkspaceExplorer(page);
	await createTerminal(page);

	await expect
		.poll(async () => (await terminalCallsFor(page, "terminal_start")).length)
		.toBe(1);
	const [startCall] = await terminalCallsFor(page, "terminal_start");
	expect(startCall?.args.request).toMatchObject({
		rootId: nativeRootId,
		profileId: "systemDefault",
		cwd: null,
	});

	await pushTerminalOutput(page, "still local");
	await expect(page.locator(".plain-terminal-grid")).toContainText(
		"still local",
	);

	const pane = page.locator(".plain-terminal-pane");
	await emitTerminalProcessExit(page, 0);
	await expect(pane).toHaveAttribute("data-terminal-exit-code", "0");
	await expect(pane).not.toHaveAttribute("data-terminal-exit-signal");

	expect(pageErrors).toEqual([]);
});

// ---------------------------------------------------------------------
// `F220` S6 — remote git core subset (SSH `exec` channel). Mirrors the S5
// remote-terminal section's own "open both the fixed native root *and* one
// mock remote root in the same window" shape — see
// `openMixedLocalAndRemoteWorkspaceForTerminal`'s own doc comment for the
// mixed-workspace rationale; the Rust side additionally proves a *purely*
// remote workspace can be granted trust too (`workspace::WorkspaceScope::
// stable_identity`'s own doc comment), but the mixed shape stays the more
// realistic one to exercise at this layer, and reuses the same established
// SSH-connect/authorize helpers as the S5 section above.
// ---------------------------------------------------------------------

/** Opens the fixed native root, connects a mock SSH session, and authorizes
 * one remote root through it — returns that remote root's own `rootId`, read
 * back off the Source Control repository selector (the only place this
 * mock's dynamically-issued remote root id is otherwise observable from the
 * test side). Never itself selects a repository or waits on trust — callers
 * decide both explicitly, since `terminalTrustedForTest` varies per
 * scenario below. */
async function openMixedLocalAndRemoteWorkspaceForGit(
	page: Page,
	init: {
		readonly terminalTrustedForTest?: boolean;
		readonly gitFixtureForTest?: TestGitFixture;
		readonly gitNetworkFixtureForTest?: TestGitNetworkFixture;
	} = {},
): Promise<{ readonly body: Locator; readonly remoteRootId: string }> {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		init.terminalTrustedForTest ?? true,
		init.gitFixtureForTest ?? {},
		init.gitNetworkFixtureForTest ?? {},
	);
	await openNativeWorkspaceExplorer(page);
	await connectMockSshSession(page, "example.com", "octocat");
	await openRemoteFolderViaQuickPick(page, ["home", "octocat", "project"]);
	// The "connected" notification toast is itself a `role="dialog"` element
	// (mirrors the `F220` S3B report's own "`.monaco-dialog-box`, not a
	// generic `role=dialog`" lesson) — cleared here so every scenario below
	// can locate a real confirmation dialog unambiguously.
	await clearAllToasts(page);

	const body = await openScmView(page);
	const selector = body.getByRole("combobox", {
		name: "Source Control Repository",
	});
	await expect(selector).toBeEnabled();
	const optionValues = await selector
		.locator("option")
		.evaluateAll((options) =>
			options.map((option) => (option as HTMLOptionElement).value),
		);
	const remoteRootId = optionValues.find(
		(value) => value.length > 0 && value !== nativeRootId,
	);
	if (remoteRootId === undefined) {
		throw new Error(
			"expected the Source Control repository selector to list the newly authorized remote root",
		);
	}

	expect(pageErrors).toEqual([]);
	return { body, remoteRootId };
}

test("F220 S6: a remote repository's status renders, and stage/commit route through the exact same UI and audited request shapes as a local root", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	const { body, remoteRootId } = await openMixedLocalAndRemoteWorkspaceForGit(
		page,
		{
			gitFixtureForTest: {
				branch: { oid: "0".repeat(40), head: "main", upstream: null },
				entries: [
					{
						type: "ordinary",
						worktreeStatus: "M",
						path: "src/remote-file.ts",
					},
				],
			},
		},
	);

	const selector = body.getByRole("combobox", {
		name: "Source Control Repository",
	});
	await selector.selectOption(remoteRootId);

	await expect
		.poll(async () => (await terminalCallsFor(page, "git_status")).length)
		.toBe(1);
	const [statusCall] = await terminalCallsFor(page, "git_status");
	expect(statusCall?.args.rootId).toBe(remoteRootId);

	const changes = body.locator(
		".plain-scm-view-changes .plain-scm-view-resource",
	);
	await expect(changes).toHaveCount(1);
	await expect(changes).toContainText("src/remote-file.ts");

	// Stage — the exact same "Stage" button and `git_stage_paths` request
	// shape a local root's own working-tree entry uses (see "Source Control
	// requires an explicit repository in a multi-root workspace…", above).
	await changes.getByRole("button", { name: "Stage", exact: true }).click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "git_stage_paths")).length)
		.toBe(1);
	const [stageCall] = await terminalCallsFor(page, "git_stage_paths");
	expect(stageCall?.args.rootId).toBe(remoteRootId);
	expect(stageCall?.args.request).toEqual({ paths: ["src/remote-file.ts"] });
	await expect(changes).toHaveCount(0);
	const staged = body.locator(
		".plain-scm-view-staged .plain-scm-view-resource",
	);
	await expect(staged).toHaveCount(1);
	await expect(staged).toContainText("src/remote-file.ts");

	// Commit.
	const input = body.locator(".plain-scm-view-input");
	await input.fill("feat: a real remote commit message");
	await body.getByRole("button", { name: "Commit", exact: true }).click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "git_commit")).length)
		.toBe(1);
	const [commitCall] = await terminalCallsFor(page, "git_commit");
	expect(commitCall?.args.rootId).toBe(remoteRootId);
	expect(commitCall?.args.request).toEqual({
		message: "feat: a real remote commit message",
		amend: false,
	});
	await expect(input).toHaveValue("");
	await expect(staged).toHaveCount(0);

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("F220 S6: git operations on an untrusted remote workspace fail closed with an accurate message and zero git_status calls, then recover once trust is granted", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	const { body, remoteRootId } = await openMixedLocalAndRemoteWorkspaceForGit(
		page,
		{
			terminalTrustedForTest: false,
			gitFixtureForTest: {
				branch: { oid: "0".repeat(40), head: "main", upstream: null },
				entries: [
					{
						type: "ordinary",
						worktreeStatus: "M",
						path: "src/remote-file.ts",
					},
				],
			},
		},
	);

	const selector = body.getByRole("combobox", {
		name: "Source Control Repository",
	});
	await selector.selectOption(remoteRootId);

	// Fail closed: an accurate, specific explanation — never a blank panel,
	// a stuck spinner, or a generic/mismatched error — and zero attempted
	// `git_status` calls (trust is checked before any exec of any kind).
	await expect(page.locator(".plain-scm-view-message")).toHaveText(
		/execution trust/,
	);
	await expect(
		body.locator(".plain-scm-view-changes .plain-scm-view-resource"),
	).toHaveCount(0);
	expect(await terminalCallsFor(page, "git_status")).toEqual([]);

	// Grant trust through the terminal panel's own prompt — `PlainScmView`
	// never prompts for trust itself (see that file's own module doc
	// comment); trust itself is workspace-wide (not per-root), exactly
	// mirroring the terminal domain's own already-established flow.
	// `createTerminal` alone is not enough in a still-ambiguous multi-root
	// workspace — `PlainTerminalView.openNewTab` defers the actual trust
	// check until a root is explicitly resolved (see that method's own doc
	// comment) — so an explicit selection in the terminal panel's own root
	// selector is what actually triggers it.
	await createTerminal(page);
	const terminalRootSelector = page.getByRole("combobox", {
		name: "New Terminal Working Folder",
	});
	await expect(terminalRootSelector).toBeEnabled();
	await terminalRootSelector.selectOption(remoteRootId);

	const confirmDialog = page.getByRole("dialog");
	await expect(confirmDialog).toBeVisible();
	await confirmDialog
		.getByRole("button", { name: "Trust & Continue", exact: true })
		.click();
	await expect(confirmDialog).toHaveCount(0);
	await expect
		.poll(
			async () =>
				(await terminalCallsFor(page, "workspace_trust_grant")).length,
		)
		.toBe(1);

	// The SCM view does not auto-refresh on a trust change elsewhere in the
	// Workbench (see `PlainScmView`'s own module doc comment) — "Plain:
	// Refresh Source Control" is the documented recovery path.
	await executePaletteCommand(
		page,
		"Refresh Source Control",
		"Plain: Refresh Source Control",
	);
	await expect
		.poll(async () => (await terminalCallsFor(page, "git_status")).length)
		.toBe(1);
	const [statusCall] = await terminalCallsFor(page, "git_status");
	expect(statusCall?.args.rootId).toBe(remoteRootId);
	await expect(
		body.locator(".plain-scm-view-changes .plain-scm-view-resource"),
	).toContainText("src/remote-file.ts");
	await expect(page.locator(".plain-scm-view-message")).toHaveText("");

	expect(pageErrors).toEqual([]);
});

test("F220 S6: fetch/pull/push and the Force checkbox are precisely disabled with an explanatory tooltip for a remote repository, and re-enabled for the native root — no network IPC ever fires for the remote one", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	const { body, remoteRootId } = await openMixedLocalAndRemoteWorkspaceForGit(
		page,
		{
			gitNetworkFixtureForTest: {
				upstream: "origin/main",
				ahead: 1,
				behind: 0,
			},
		},
	);

	const selector = body.getByRole("combobox", {
		name: "Source Control Repository",
	});
	const fetchButton = body.getByRole("button", { name: "Fetch", exact: true });
	const pullButton = body.getByRole("button", { name: "Pull", exact: true });
	const pushButton = body.getByRole("button", { name: "Push", exact: true });
	const forceCheckbox = body.getByRole("checkbox", {
		name: "Force Push (with lease)",
	});

	await selector.selectOption(remoteRootId);
	await expect
		.poll(async () => (await terminalCallsFor(page, "git_status")).length)
		.toBe(1);

	const disabledTitle =
		"Network operations (fetch, pull, push) are not supported for a remote repository.";
	await expect(fetchButton).toBeDisabled();
	await expect(pullButton).toBeDisabled();
	await expect(pushButton).toBeDisabled();
	await expect(forceCheckbox).toBeDisabled();
	await expect(fetchButton).toHaveAttribute("title", disabledTitle);
	await expect(pullButton).toHaveAttribute("title", disabledTitle);
	await expect(pushButton).toHaveAttribute("title", disabledTitle);
	await expect(forceCheckbox).toHaveAttribute("title", disabledTitle);

	// Defense in depth: even a forced click (bypassing the browser's own
	// disabled-control click suppression) must never reach the bridge — see
	// `PlainScmView.previewNetworkOperation`'s own early remote check.
	await fetchButton.click({ force: true });
	await pullButton.click({ force: true });
	await pushButton.click({ force: true });
	expect(await terminalCallsFor(page, "git_fetch")).toEqual([]);
	expect(await terminalCallsFor(page, "git_pull")).toEqual([]);
	expect(await terminalCallsFor(page, "git_push")).toEqual([]);
	expect(await terminalCallsFor(page, "git_network_preview")).toEqual([]);

	// Switching back to the native root re-enables every control, with no
	// leftover tooltip.
	await selector.selectOption(nativeRootId);
	await expect
		.poll(async () => (await terminalCallsFor(page, "git_status")).length)
		.toBe(2);
	await expect(fetchButton).toBeEnabled();
	await expect(pullButton).toBeEnabled();
	await expect(pushButton).toBeEnabled();
	await expect(forceCheckbox).toBeEnabled();
	await expect(fetchButton).not.toHaveAttribute("title");
	await expect(pullButton).not.toHaveAttribute("title");
	await expect(pushButton).not.toHaveAttribute("title");
	await expect(forceCheckbox).not.toHaveAttribute("title");

	// And a real fetch against the native root still works normally,
	// confirming the disable is genuinely scoped to the remote root, not a
	// global regression.
	await fetchButton.click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: "Fetch", exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await expect
		.poll(async () => (await terminalCallsFor(page, "git_fetch")).length)
		.toBe(1);
	const [fetchCall] = await terminalCallsFor(page, "git_fetch");
	expect(fetchCall?.args.rootId).toBe(nativeRootId);

	expect(pageErrors).toEqual([]);
});

test("F220 S6: fetch/pull/push against a remote root are rejected server-side with the dedicated code even if a client-side check were bypassed", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	const { remoteRootId } = await openMixedLocalAndRemoteWorkspaceForGit(page, {
		gitNetworkFixtureForTest: { upstream: "origin/main", ahead: 0, behind: 0 },
	});

	// Bypasses the view entirely and invokes the native transport directly
	// with the remote root's id — proves the mock's own fail-closed check
	// (mirroring the real Rust `git::network::reject_remote_root`) is not
	// merely a client-side UI nicety the view happens to also enforce.
	const error = await page.evaluate(async (rootId) => {
		try {
			await (
				window as unknown as {
					__TAURI_INTERNALS__: {
						invoke: (
							command: string,
							args: Record<string, unknown>,
						) => Promise<unknown>;
					};
				}
			).__TAURI_INTERNALS__.invoke("git_fetch", {
				rootId,
				request: {},
			});
			return null;
		} catch (caught) {
			return caught as { code?: string; message?: string };
		}
	}, remoteRootId);
	expect(error?.code).toBe("GIT_REMOTE_NETWORK_UNSUPPORTED");
	expect(error?.code).not.toBe("ROOT_BACKEND_UNSUPPORTED");

	expect(pageErrors).toEqual([]);
});

// --- `F220` S7 "远程 DAP" ----------------------------------------------------

const DEBUG_LAUNCH_JSON_REMOTE = JSON.stringify({
	version: "0.2.0",
	configurations: [
		{
			type: "python",
			request: "launch",
			name: "Debug remote main.py",
			plainAdapter: {
				transport: "stdio",
				command: "/usr/bin/python3",
				args: ["-m", "debugpy.adapter"],
			},
			program: "main.py",
		},
	],
});

/** Opens a mixed local+remote workspace (mirrors
 * `openMixedLocalAndRemoteWorkspaceForGit`'s own identical shape) with a
 * remote root that carries `main.py` and `.vscode/launch.json` — the
 * shared setup every `F220` S7 test below starts from. Trust is granted
 * up front (`terminalTrustedForTest: true`) so each test can focus on the
 * adapter-confirmation gate itself, the one this slice actually changes. */
async function openMixedLocalAndRemoteWorkspaceForDebug(
	page: Page,
	debugFixtureForTest: TestDebugFixture = {},
): Promise<{ readonly remoteRootId: string }> {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		{},
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{},
		{},
		debugFixtureForTest,
		{},
		[],
		0,
		0,
		null,
		{
			directoryTreeForTest: {
				"/home": "directory",
				"/home/octocat": "directory",
				"/home/octocat/project": "directory",
				"/home/octocat/project/.vscode": "directory",
				"/home/octocat/project/main.py": { content: DEBUG_MAIN_PY },
				"/home/octocat/project/.vscode/launch.json": {
					content: DEBUG_LAUNCH_JSON_REMOTE,
				},
			},
		},
	);
	await openNativeWorkspaceExplorer(page);
	await connectMockSshSession(page, "example.com", "octocat");
	await openRemoteFolderViaQuickPick(page, ["home", "octocat", "project"]);
	await clearAllToasts(page);

	const remoteRootIds = await page.evaluate(() =>
		(
			window as unknown as {
				__PLAIN_TEST_REMOTE_ROOT_IDS__(): readonly string[];
			}
		).__PLAIN_TEST_REMOTE_ROOT_IDS__(),
	);
	expect(remoteRootIds).toHaveLength(1);
	const remoteRootId = remoteRootIds[0]!;
	expect(remoteRootId).not.toBe(nativeRootId);

	expect(pageErrors).toEqual([]);
	return { remoteRootId };
}

/** Drives "Plain: Start Debugging" through the multi-root picker (selecting
 * the remote root by its own mock-assigned display name, "project" — the
 * leaf segment of `/home/octocat/project`, see
 * `browser-mock.ts`'s own `remoteMockDisplayName`), then the adapter
 * confirmation dialog (trust is already granted by the caller's own setup,
 * so no trust dialog appears — mirrors `startForRoot`'s identical shape in
 * "Debug requires an explicit multi-root choice…"). A caller starting a
 * *second* session against the same already-confirmed `(command, args,
 * transport)` triple within the same page (no intervening navigation — see
 * `resolveDebugAdapterConfirmation`'s own "already-confirmed" skip-dialog
 * branch) correctly sees no dialog at all here; this function handles both
 * outcomes. Returns the live session id once `debug_launch` has actually
 * completed. */
async function startRemoteDebugSession(page: Page): Promise<string> {
	await openRunAndDebugView(page);
	await executePaletteCommandThatMayReopenAQuickInput(
		page,
		"Start Debugging",
		"Plain: Start Debugging",
	);
	const palette = page.locator(".quick-input-widget");
	await expect(palette.locator("input")).toHaveAttribute(
		"placeholder",
		"Select a workspace folder to debug",
	);
	const remoteRow = palette
		.locator(".quick-input-list .monaco-list-row")
		.filter({ hasText: "project" });
	await expect(remoteRow).toHaveCount(1);
	const launchCallsBefore = (await terminalCallsFor(page, "debug_launch"))
		.length;
	await remoteRow.click();
	await expect(palette).toBeHidden();

	const dialog = page.getByRole("dialog");
	await expect
		.poll(async () => {
			if (await dialog.isVisible()) {
				return true;
			}
			return (
				(await terminalCallsFor(page, "debug_launch")).length >
				launchCallsBefore
			);
		})
		.toBe(true);
	if (await dialog.isVisible()) {
		await expect(dialog).toContainText('Run "/usr/bin/python3"?');
		// `F220` S7 — the confirmation dialog's own "如实反映" of *where* this
		// command is about to run, not merely a cosmetic label (see
		// `debugAdapterConfirmationDetail`'s own doc comment).
		await expect(dialog).toContainText(
			"This command will run on the remote host for this workspace root, not on this machine.",
		);
		await dialog
			.getByRole("button", { name: "Run Adapter", exact: true })
			.click();
		await expect(dialog).toHaveCount(0);
	}

	await expect
		.poll(async () => (await terminalCallsFor(page, "debug_launch")).length)
		.toBe(launchCallsBefore + 1);
	return currentDebugSessionId(page);
}

test("F220 S7: full remote debug chain — launch.json read, root picker, remote-flavored confirmation, breakpoints, stopped, call stack/variables, disconnect", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	const { remoteRootId } = await openMixedLocalAndRemoteWorkspaceForDebug(
		page,
		{
			stackFramesByThread: {
				1: [
					{
						id: 1,
						name: "main",
						line: 6,
						column: 5,
						sourcePath: "main.py",
						sourceName: "main.py",
						instructionPointerReference: null,
					},
				],
			},
			scopesByFrame: {
				1: [
					{
						name: "Locals",
						variablesReference: 100,
						namedVariables: 1,
						indexedVariables: null,
						expensive: false,
					},
				],
			},
			variablesByReference: {
				100: [
					{
						name: "total",
						value: "7",
						type: "int",
						variablesReference: 0,
						namedVariables: null,
						indexedVariables: null,
					},
				],
			},
		},
	);

	// launch.json 读取: a real `workspace_read_file` against the remote root,
	// not a canned response — confirmed below via the real request shape.
	// `openMixedLocalAndRemoteWorkspaceForDebug`'s own `openNativeWorkspaceExplorer`
	// call already leaves Explorer as the active, visible view (a second
	// click on its own activity-bar tab would toggle it closed instead).
	const explorer = page.getByRole("tree", { name: "Files Explorer" });
	await expect(explorer).toBeVisible();
	await explorer
		.getByRole("treeitem", { name: "main.py", exact: true })
		.dblclick();
	await expect(
		page.getByRole("tab", { name: /^main\.py(?:,.*)?$/ }),
	).toBeVisible();

	// 配置选择 (root picker) + 确认门 (remote-flavored copy) — see
	// `startRemoteDebugSession`'s own doc comment.
	const sessionId = await startRemoteDebugSession(page);
	const [launchCall] = await terminalCallsFor(page, "debug_launch");
	expect(launchCall?.args.request).toMatchObject({
		rootId: remoteRootId,
		command: "/usr/bin/python3",
		args: ["-m", "debugpy.adapter"],
		adapterId: "python",
		arguments: { program: "main.py" },
	});
	const launchReads = (
		await terminalCallsFor(page, "workspace_read_file")
	).filter(
		(call) =>
			(call.args.request as { relativePath?: string }).relativePath ===
			".vscode/launch.json",
	);
	expect(
		launchReads.some(
			(call) =>
				(call.args.request as { rootId?: string }).rootId === remoteRootId,
		),
	).toBe(true);

	// 断点: a real glyph-margin click on the *remote* file syncs through the
	// exact same `debug_set_breakpoints` request shape a local root uses,
	// carrying the remote root's own id.
	await clickGlyphMargin(page, "total = add(3, 4)");
	await expect
		.poll(
			async () =>
				(await terminalCallsFor(page, "debug_set_breakpoints")).length,
		)
		.toBe(1);
	const [breakpointsCall] = await terminalCallsFor(
		page,
		"debug_set_breakpoints",
	);
	expect(breakpointsCall?.args.request).toEqual({
		sessionId,
		rootId: remoteRootId,
		path: "main.py",
		breakpoints: [
			{ line: 6, condition: null, logMessage: null, hitCondition: null },
		],
	});
	const glyph = page.locator(".plain-debug-breakpoint-glyph");
	await expect(glyph).toHaveClass(/plain-debug-breakpoint-glyph-verified/);

	// stopped → 调用栈/变量: a real `stopped` event drives a real
	// `debug_stack_trace`/`debug_scopes`/`debug_variables` chain, rendering
	// the seeded remote frame/scope/variable.
	await emitDebugTestEvent(page, sessionId, "stopped", {
		threadId: 1,
		reason: "breakpoint",
	});
	await expect(
		page.locator(".plain-debug-call-stack-view-frame-button"),
	).toHaveText(["main (main.py:6)"]);
	const tree = page.locator(".plain-debug-variables-view-tree");
	const localsNode = tree
		.locator(":scope > .plain-debug-variables-node")
		.filter({ hasText: "Locals" });
	await expect(localsNode).toHaveCount(1);
	await localsNode
		.locator(
			":scope > .plain-debug-variables-row > .plain-debug-variables-toggle",
		)
		.click();
	await expect(
		localsNode.locator(
			":scope > .plain-debug-variables-children > .plain-debug-variables-node",
		),
	).toHaveText(["total: 7 (int)"]);

	// 断开: `Plain: Stop Debugging` tears the session down cleanly — no
	// session-ended toast for a deliberate stop (see the next test for the
	// distinct-notification half of this same contract).
	await executePaletteCommand(page, "Stop Debugging", "Plain: Stop Debugging");
	await expect
		.poll(async () => (await terminalCallsFor(page, "debug_disconnect")).length)
		.toBe(1);
	expect(
		await page.locator(".notifications-toasts .notification-toast").count(),
	).toBe(0);

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("F220 S7: a mid-session remote disconnect shows the same distinct sessionEnded notification a local adapter crash would, never disguised as a deliberate stop", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await openMixedLocalAndRemoteWorkspaceForDebug(page);
	const explorer = page.getByRole("tree", { name: "Files Explorer" });
	await expect(explorer).toBeVisible();
	await explorer
		.getByRole("treeitem", { name: "main.py", exact: true })
		.dblclick();
	await expect(
		page.getByRole("tab", { name: /^main\.py(?:,.*)?$/ }),
	).toBeVisible();

	const toasts = page.locator(".notifications-toasts .notification-toast");
	const transportClosedToast = toasts.filter({
		hasText: "the debug adapter's connection closed unexpectedly",
	});

	// Control, run first: a deliberate stop shows no such notification —
	// proves the meaningful interaction below is a real, distinct signal,
	// not this Workbench always toasting on session end.
	await startRemoteDebugSession(page);
	await executePaletteCommand(page, "Stop Debugging", "Plain: Stop Debugging");
	await expect
		.poll(async () => (await terminalCallsFor(page, "debug_disconnect")).length)
		.toBe(1);
	await expect(toasts).toHaveCount(0);

	// Meaningful interaction: research doc S7's own "会话按既有 adapter-died
	// 路径终结（reader EOF 语义）" — from the frontend's own perspective this
	// is indistinguishable from a local adapter's transport closing, exactly
	// the point: no separate remote-specific event/copy exists, or needs to.
	const sessionId = await startRemoteDebugSession(page);
	await emitDebugTestEvent(page, sessionId, "plain/sessionEnded", {
		reason: "transportClosed",
	});
	await expect(transportClosedToast).toHaveCount(1);

	expect(pageErrors).toEqual([]);
});

test("F220 S7: a tcp/tcpSpawn transport request against a remote root is rejected with the dedicated code, even bypassing the UI's own transport choice", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	const { remoteRootId } = await openMixedLocalAndRemoteWorkspaceForDebug(page);

	// Grants the `tcp` identity's own confirmation first — proves the
	// rejection below is the dedicated transport-level check, not merely an
	// unconfirmed-subject rejection reusing the same error family.
	// `debug_adapter_confirmation_grant`'s wire shape is `{request, rootId}`
	// (`rootId` a sibling of `request`, not nested inside it — `F220` S7) —
	// `directTauriInvoke` always wraps its whole payload as `{request}`, so
	// this one call is built directly instead.
	await page.evaluate(
		({ rootId }) => {
			const testWindow = window as unknown as {
				__TAURI_INTERNALS__: {
					invoke(command: string, args?: unknown): Promise<unknown>;
				};
			};
			return testWindow.__TAURI_INTERNALS__.invoke(
				"debug_adapter_confirmation_grant",
				{
					request: {
						command: "/usr/bin/lldb-dap",
						args: [],
						transport: "tcp",
					},
					rootId,
				},
			);
		},
		{ rootId: remoteRootId },
	);

	const tcpError = (await page.evaluate(async (rootId) => {
		const testWindow = window as unknown as {
			__TAURI_INTERNALS__: {
				invoke(command: string, args?: unknown): Promise<unknown>;
			};
		};
		try {
			await testWindow.__TAURI_INTERNALS__.invoke("debug_launch", {
				request: {
					rootId,
					transport: "tcp",
					command: "/usr/bin/lldb-dap",
					args: [],
					host: "127.0.0.1",
					port: 5678,
					adapterId: "lldb",
					arguments: {},
				},
			});
			return null;
		} catch (error) {
			return error as { code?: string; message?: string };
		}
	}, remoteRootId)) as { code?: string; message?: string } | null;
	expect(tcpError?.code).toBe("DEBUG_REMOTE_TRANSPORT_UNSUPPORTED");
	expect(tcpError?.code).not.toBe("ROOT_BACKEND_UNSUPPORTED");
	expect(tcpError?.code).not.toBe("DEBUG_ADAPTER_NOT_CONFIRMED");

	const tcpSpawnError = (await page.evaluate(async (rootId) => {
		const testWindow = window as unknown as {
			__TAURI_INTERNALS__: {
				invoke(command: string, args?: unknown): Promise<unknown>;
			};
		};
		try {
			await testWindow.__TAURI_INTERNALS__.invoke("debug_launch", {
				request: {
					rootId,
					transport: "tcpSpawn",
					command: "/usr/bin/python3",
					args: ["-m", "debugpy.adapter", "--listen"],
					port: 5678,
					adapterId: "python",
					arguments: {},
				},
			});
			return null;
		} catch (error) {
			return error as { code?: string; message?: string };
		}
	}, remoteRootId)) as { code?: string; message?: string } | null;
	expect(tcpSpawnError?.code).toBe("DEBUG_REMOTE_TRANSPORT_UNSUPPORTED");

	// Neither rejected attempt ever produced a live session — both raced
	// entirely before `debug_launch`'s own `sessionId` allocation, so there
	// is nothing for the frontend to have tracked.
	const sessionIds = await page.evaluate(() =>
		(
			window as unknown as {
				__PLAIN_TEST_DEBUG_SESSION_IDS__(): readonly string[];
			}
		).__PLAIN_TEST_DEBUG_SESSION_IDS__(),
	);
	expect(sessionIds).toEqual([]);

	expect(pageErrors).toEqual([]);
});
