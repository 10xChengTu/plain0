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
}
interface TestDebugScope {
	readonly name: string;
	readonly variablesReference: number;
	readonly namedVariables: number | null;
	readonly indexedVariables: number | null;
	readonly expensive: boolean;
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
): Promise<void> {
	await page.addInitScript(
		({
			goldenRead,
			mode,
			rawReadTransport,
			pngBase64,
			extraFiles,
			textSearchMaxMatchesForTest,
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
			let currentSnapshot: typeof emptySnapshot | typeof selectedSnapshot =
				emptySnapshot;
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
			const loadBackupEntries = (): Map<string, Uint8Array> => {
				const raw = sessionStorage.getItem(BACKUP_STORAGE_KEY);
				if (raw === null) {
					return new Map();
				}
				try {
					const parsed = JSON.parse(raw) as Array<[string, number[]]>;
					return new Map(
						parsed.map(([key, bytes]) => [key, Uint8Array.from(bytes)]),
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
						[...backupEntries.entries()].map(([key, bytes]) => [
							key,
							Array.from(bytes),
						]),
					),
				);
			};
			const plbkFrame = (
				value: Uint8Array,
			): { key: string; content: Uint8Array } => {
				if (
					value.byteLength < 9 ||
					value[0] !== 0x50 ||
					value[1] !== 0x4c ||
					value[2] !== 0x42 ||
					value[3] !== 0x4b
				) {
					throw new Error("Malformed PLBK browser test frame.");
				}
				const view = new DataView(
					value.buffer,
					value.byteOffset,
					value.byteLength,
				);
				const keyLength = value[4]!;
				const contentLength = view.getUint32(5, false);
				if (9 + keyLength + contentLength !== value.byteLength) {
					throw new Error("Malformed PLBK browser test frame length.");
				}
				const key = decoder.decode(value.slice(9, 9 + keyLength));
				const content = value.slice(9 + keyLength);
				return { key, content };
			};
			const encodeBackupReadAllFrame = (): Uint8Array => {
				const entries = [...backupEntries.entries()];
				let total = 8;
				const encoded = entries.map(([key, bytes]) => {
					const keyBytes = encoder.encode(key);
					total += 5 + keyBytes.byteLength + bytes.byteLength;
					return { keyBytes, bytes };
				});
				const frame = new Uint8Array(total);
				const view = new DataView(frame.buffer);
				frame.set([0x50, 0x4c, 0x42, 0x41], 0); // "PLBA"
				view.setUint32(4, entries.length, false);
				let offset = 8;
				for (const { keyBytes, bytes } of encoded) {
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
			const resolveNode = (relativePath: string): MockNode => {
				let node: MockNode = root;
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
			): { parent: MockDirectory; name: string } => {
				const segments = pathSegments(relativePath);
				if (segments.length === 0) {
					throw entryTypeMismatch();
				}
				const name = segments.at(-1)!;
				const parentPath = segments.slice(0, -1).join("/");
				const parent = resolveNode(parentPath);
				if (parent.kind !== "directory") {
					throw entryTypeMismatch();
				}
				return { parent, name };
			};
			const deleteNode = (relativePath: string): void => {
				const { parent, name } = resolveParent(relativePath);
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
			): { entries: string[]; limitHit: boolean } => {
				const excludeMatchers = excludeGlobs.map(compileExcludeGlob);
				const patternLower = filePattern.toLowerCase();
				const entries: string[] = [];
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
							entries.push(wire);
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
			const compileTextSearchMatcher = (
				pattern: string,
				isRegExp: boolean,
				isCaseSensitive: boolean,
				isWordMatch: boolean,
			): RegExp => {
				const source = isRegExp ? pattern : escapeTextSearchRegExp(pattern);
				const wrapped = isWordMatch ? `\\b(?:${source})\\b` : source;
				try {
					return new RegExp(wrapped, isCaseSensitive ? "gu" : "giu");
				} catch {
					throw invalidSearchRegex();
				}
			};
			interface TextSearchBatch {
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
				const maxFileSize = request.maxFileSize ?? 8 * 1_024 * 1_024;
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
							pending.push({ path: wire, matches });
						}
						if (remainingBudget <= 0) {
							limitHit = true;
							break rootsLoop;
						}
					}
				}
				return { pending, limitHit, skippedBinary, skippedOversize };
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
						relativePath: string;
						recursive: boolean;
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
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: typeof calls;
				__PLAIN_TEST_EXTERNAL_CREATE__(name: string, emitWake: boolean): void;
				__PLAIN_TEST_EXTERNAL_DELETE__(name: string, emitWake: boolean): void;
				__PLAIN_TEST_EXTERNAL_WRITE__(
					name: string,
					content: string,
					emitWake: boolean,
				): void;
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
						cells: Array.from({ length: session.cols }, (_unused, col) => ({
							graphemes: line[col] ?? "",
							fg: null,
							bg: null,
							style: DEFAULT_TERMINAL_STYLE,
						})),
					})),
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
			): void {
				const payload = { sessionId: session.sessionId, exitCode };
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
			function gitNoRepository() {
				return {
					code: "GIT_NO_REPOSITORY",
					message: "The current workspace root is not a Git repository.",
				};
			}

			// --- `F100` S3: real session-lifecycle + interactive debugging mock. ---
			const debugAdapterConfirmations = new Set<string>();
			function debugAdapterConfirmationKey(request: {
				command?: string;
				args?: readonly string[];
				transport?: string;
			}): string {
				return JSON.stringify([
					request.command,
					request.args,
					request.transport,
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
			const mockGitRefs: TestGitRefsListResult =
				gitFixtureForTest.refsForTest ?? { entries: [], truncated: false };
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
						if (frame.rootId !== rootId) {
							throw entryNotFound();
						}
						const node = resolveNode(frame.relativePath);
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
							throw new Error("Expected one raw PLBK browser test frame.");
						}
						const frame = plbkFrame(args);
						calls.push({
							command,
							args: { key: frame.key, contentHex: hexFromBytes(frame.content) },
						});
						backupEntries.set(frame.key, frame.content.slice());
						persistBackupEntries();
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
						case "workspace_capabilities":
							return {
								create: true,
								renameNoReplace: true,
								copyMove: true,
								delete: mode === "supported",
								versionedWrite: true,
							};
						case "workspace_snapshot":
							return currentSnapshot;
						case "workspace_pick_roots":
							currentSnapshot = selectedSnapshot;
							return { status: "selected", snapshot: selectedSnapshot };
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
							if (request?.rootId !== rootId) {
								throw entryNotFound();
							}
							const relativePath = request.relativePath ?? "";
							const { parent, name } = resolveParent(relativePath);
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
							if (request?.rootId !== rootId) {
								throw entryNotFound();
							}
							const relativePath = request.relativePath ?? "";
							const { parent, name } = resolveParent(relativePath);
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
							if (rename?.rootId !== rootId) {
								throw entryNotFound();
							}
							const sourcePath = rename.sourcePath ?? "";
							const targetPath = rename.targetPath ?? "";
							const source = resolveParent(sourcePath);
							const target = resolveParent(targetPath);
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
								prepare?.entries?.length !== 1 ||
								entry?.rootId !== rootId ||
								typeof entry.relativePath !== "string" ||
								entry.recursive !== true
							) {
								throw invalidDeletePlan();
							}
							const node = resolveNode(entry.relativePath);
							const confirmationId = nextDeleteId();
							const entryId = nextDeleteId();
							activeDelete = {
								confirmationId,
								entryId,
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
								commit.rootId !== rootId ||
								commit.relativePath !== activeDelete.relativePath ||
								commit.recursive !== activeDelete.recursive
							) {
								throw invalidDeletePlan();
							}
							deleteNode(activeDelete.relativePath);
							activeDelete = undefined;
							return { status: "deleted" };
						}
						case "workspace_stat": {
							const relativePath = request?.relativePath ?? "";
							if (request?.rootId !== rootId) {
								throw entryNotFound();
							}
							const node = resolveNode(relativePath);
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
							if (request?.rootId !== rootId) {
								throw entryNotFound();
							}
							const node = resolveNode(relativePath);
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
						case "workspace_read_file": {
							const relativePath = request?.relativePath ?? "";
							if (request?.rootId !== rootId) {
								throw entryNotFound();
							}
							const node = resolveNode(relativePath);
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
							const key = (args.request as { key?: string } | undefined)?.key;
							if (typeof key !== "string") {
								throw new Error("Malformed backup_discard test request.");
							}
							backupEntries.delete(key);
							persistBackupEntries();
							return null;
						}
						case "backup_discard_all": {
							backupEntries.clear();
							persistBackupEntries();
							return null;
						}
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
							return {
								confirmed: debugAdapterConfirmations.has(
									debugAdapterConfirmationKey(confirmRequest ?? {}),
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
							debugAdapterConfirmations.add(
								debugAdapterConfirmationKey(confirmRequest ?? {}),
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
							debugAdapterConfirmations.delete(
								debugAdapterConfirmationKey(confirmRequest ?? {}),
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
										command?: string;
										args?: readonly string[];
										transport?: string;
								  }
								| undefined;
							if (
								!debugAdapterConfirmations.has(
									debugAdapterConfirmationKey(startRequest ?? {}),
								)
							) {
								throw debugAdapterNotConfirmed();
							}
							const sessionId = nextDebugSessionId();
							liveDebugSessions.add(sessionId);
							return {
								sessionId,
								capabilities: debugFixtureForTest.capabilities ?? {},
							};
						}
						case "debug_disconnect": {
							const disconnectRequest = args.request as
								{ sessionId?: string } | undefined;
							if (
								!liveDebugSessions.delete(disconnectRequest?.sessionId ?? "")
							) {
								throw debugSessionNotFound();
							}
							return null;
						}
						case "debug_set_breakpoints": {
							const setBreakpointsRequest = args.request as
								| {
										sessionId?: string;
										path?: string;
										breakpoints?: readonly { line: number }[];
								  }
								| undefined;
							if (
								!liveDebugSessions.has(setBreakpointsRequest?.sessionId ?? "")
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
						case "terminal_start": {
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							const startRequest = args.request as
								{ cols?: number; rows?: number } | undefined;
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
							};
							terminalSessions.set(sessionId, session);
							lastStartedTerminalSessionId = sessionId;
							return { sessionId };
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
							emitTerminalExit(session, 137);
							return null;
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
							if (!terminalTrusted) {
								throw terminalNotTrusted();
							}
							if (gitFixtureForTest.noRepositoryForTest === true) {
								throw gitNoRepository();
							}
							return mockGitRefs;
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
		},
	);
}

async function installMultiRootNativeIpcMock(
	page: Page,
	mode: NativeIpcMockMode = "readonly",
	moveIncompleteScenarios: readonly TestMultiRootMoveIncompleteScenario[] = [],
	deleteIncompleteScenarios: readonly TestMultiRootDeleteIncompleteScenario[] = [],
): Promise<void> {
	await page.addInitScript(
		({
			mode,
			moveIncompleteScenarios,
			deleteIncompleteScenarios,
			workspaceId,
			primaryRootId,
			secondaryRootId,
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
			const encoder = new TextEncoder();
			const decoder = new TextDecoder();
			// This fixture never exercises a reload, so (unlike
			// installNativeIpcMock's own hot-exit backup store) this one is
			// purely in-memory: its only job is to let the real backup
			// tracker's schedule/discard lifecycle, now active across every
			// fixture, complete without hitting the closed `default:` case
			// below whenever a multi-root test edits or saves a file.
			const backupEntries = new Map<string, Uint8Array>();
			const plbkFrame = (
				value: Uint8Array,
			): { key: string; content: Uint8Array } => {
				if (
					value.byteLength < 9 ||
					value[0] !== 0x50 ||
					value[1] !== 0x4c ||
					value[2] !== 0x42 ||
					value[3] !== 0x4b
				) {
					throw new Error("Malformed PLBK multi-root test frame.");
				}
				const view = new DataView(
					value.buffer,
					value.byteOffset,
					value.byteLength,
				);
				const keyLength = value[4]!;
				const contentLength = view.getUint32(5, false);
				if (9 + keyLength + contentLength !== value.byteLength) {
					throw new Error("Malformed PLBK multi-root test frame length.");
				}
				const key = decoder.decode(value.slice(9, 9 + keyLength));
				const content = value.slice(9 + keyLength);
				return { key, content };
			};
			const encodeBackupReadAllFrame = (): Uint8Array => {
				const entries = [...backupEntries.entries()];
				let total = 8;
				const encoded = entries.map(([key, bytes]) => {
					const keyBytes = encoder.encode(key);
					total += 5 + keyBytes.byteLength + bytes.byteLength;
					return { keyBytes, bytes };
				});
				const frame = new Uint8Array(total);
				const view = new DataView(frame.buffer);
				frame.set([0x50, 0x4c, 0x42, 0x41], 0); // "PLBA"
				view.setUint32(4, entries.length, false);
				let offset = 8;
				for (const { keyBytes, bytes } of encoded) {
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
				["copy-source.txt", file("Copy across roots.\n")],
				["src", directory([])],
			];
			if (deleteIncompleteScenarios.includes("deleteRetained")) {
				primaryEntries.push([
					"delete-retained.txt",
					file("Retain this delete target.\n"),
				]);
			}
			const secondaryEntries: Array<readonly [string, MockNode]> = [
				["move-source.txt", file("Move across roots.\n")],
				["notes.txt", file("Secondary workspace\n")],
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
			const watchStates = new Map<string, WatchState>();
			let revision = 0;

			const rootNotAuthorized = () => ({
				code: "ROOT_NOT_AUTHORIZED",
				message: "The workspace root is not authorized.",
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
							throw new Error("Expected one raw PLBK multi-root test frame.");
						}
						const frame = plbkFrame(args);
						backupEntries.set(frame.key, frame.content.slice());
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
						case "workspace_capabilities":
							return {
								create: mode === "supported",
								renameNoReplace: mode === "supported",
								copyMove: mode === "supported",
								delete: mode === "supported",
								versionedWrite: mode === "supported",
							};
						case "workspace_snapshot":
							return snapshot();
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
								return { status: "selected", snapshot: snapshot() };
							}
							if (request?.mode === "add") {
								if (activeRoots.size !== 1 || !activeRoots.has(primaryRootId)) {
									throw new Error("Unexpected add-root browser test state.");
								}
								activeRoots.set(secondaryRootId, secondaryRoot);
								invalidateRoot(secondaryRootId);
								revision += 1;
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
							const key = (args.request as { key?: string } | undefined)?.key;
							if (typeof key !== "string") {
								throw new Error("Malformed backup_discard test request.");
							}
							backupEntries.delete(key);
							return null;
						}
						case "backup_discard_all":
							backupEntries.clear();
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
	await page.getByRole("tab", { name: /^Explorer / }).click();
	const explorer = page.getByRole("tree", { name: "Files Explorer" });
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

	// Exercise the route that originally failed silently: the context menu is
	// disposed before the confirm-dialog-gated action settles, so the
	// coordinator must publish the final Error notification itself.
	const deletePermanently = async (
		item: Locator,
		name: string,
	): Promise<number> => {
		const phaseStart = await currentCallCount();
		await activateExplorerContextAction(page, item, "Delete Permanently");
		const dialog = page.locator(".monaco-dialog-box");
		await expect(dialog).toHaveCount(1);
		await expect(dialog).toContainText(`永久删除“${name}”？`);
		await expect(dialog).toContainText("此操作永久且不可撤销");
		await expect(dialog).toContainText("不会移入废纸篓");
		await dialog.getByRole("button", { name: "永久删除", exact: true }).click();
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
			.filter({ hasText: "The permanent delete selection is invalid." });
		await expect(warningToast).toHaveCount(1);
		await expect(warningToast).toContainText(
			"The permanent delete selection is invalid.",
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

	await expect(page.locator(".plain-terminal-status")).toHaveText(
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

	const headText = await page.evaluate(() =>
		(
			window as unknown as {
				__PLAIN_TEST_RESOLVE_GIT_TEXT__(
					rev: "head" | "index",
					path: string,
				): Promise<string | null>;
			}
		).__PLAIN_TEST_RESOLVE_GIT_TEXT__("head", "src/a.ts"),
	);
	expect(headText).toBe("export const a = 1;\n");

	const indexText = await page.evaluate(() =>
		(
			window as unknown as {
				__PLAIN_TEST_RESOLVE_GIT_TEXT__(
					rev: "head" | "index",
					path: string,
				): Promise<string | null>;
			}
		).__PLAIN_TEST_RESOLVE_GIT_TEXT__("index", "src/a.ts"),
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

test("Plain: Stage First Change in Active File (Hunk) computes the hunk-applied content via Monaco's diff engine and calls git_stage_blob", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await installNativeIpcMock(
		page,
		"arrayBuffer",
		"readonly",
		// The working-tree (on-disk) content `workspaceReadFile` serves.
		{ "src/hunk.ts": "ONE\ntwo\nTHREE\n" },
		20_000,
		0,
		[],
		[],
		null,
		null,
		null,
		true,
		{
			entries: [{ type: "ordinary", worktreeStatus: "M", path: "src/hunk.ts" }],
			// The index version `gitShowBlob("index", …)` serves — two
			// independent hunks against the working-tree content above.
			blobs: { "src/hunk.ts": { index: "one\ntwo\nthree\n" } },
		},
	);
	await openNativeWorkspaceExplorer(page);
	const body = await openScmView(page);

	await body
		.locator(".plain-scm-view-changes .plain-scm-view-resource")
		.getByText("src/hunk.ts")
		.click();
	const editorTab = page.getByRole("tab", { name: /^hunk\.ts(?:,.*)?$/ });
	await expect(editorTab).toBeVisible();

	await executePaletteCommand(
		page,
		"Stage First Change",
		"Plain: Stage First Change in Active File (Hunk)",
	);

	await expect
		.poll(async () => (await terminalCallsFor(page, "git_stage_blob")).length)
		.toBe(1);
	const call = (await terminalCallsFor(page, "git_stage_blob"))[0]!;
	const request = call.args.request as { path: string; content: number[] };
	expect(request.path).toBe("src/hunk.ts");
	// Only the first hunk ("one" -> "ONE") applied; the second ("three" ->
	// "THREE") left as the original index content — proves this used
	// Monaco's real per-hunk diff, not a whole-file copy.
	expect(new TextDecoder().decode(new Uint8Array(request.content))).toBe(
		"ONE\ntwo\nthree\n",
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
					},
					{
						id: 2,
						name: "<module>",
						line: 10,
						column: 1,
						sourcePath: "main.py",
						sourceName: "main.py",
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
	await expect(dialog).toContainText('Run "/usr/bin/python3"?');
	await dialog
		.getByRole("button", { name: "Run Adapter", exact: true })
		.click();
	await expect(dialog).toHaveCount(0);

	await expect
		.poll(async () => (await terminalCallsFor(page, "debug_launch")).length)
		.toBe(1);
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
		path: "main.py",
		breakpoints: [{ line: 6, condition: null, logMessage: null }],
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

test("breakpoint popup disables condition/log-point inputs when the adapter's capabilities do not advertise support, and a rejected breakpoint renders distinctly", async ({
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
	await expect(conditionInput).toBeDisabled();
	await expect(logInput).toBeDisabled();
	await expect(conditionInput).toHaveAttribute(
		"placeholder",
		"Not supported by this adapter",
	);
	await expect(logInput).toHaveAttribute(
		"placeholder",
		"Not supported by this adapter",
	);

	expect(pageErrors).toEqual([]);
});

test("breakpoint popup enables condition/log-point inputs when the adapter advertises support, and saving re-syncs the live session", async ({
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
	// support — the exact two inputs the previous test proved disabled are
	// now genuinely enabled.
	await clickGlyphMargin(page, "total = add(3, 4)", "right");
	const popup = page.locator(".plain-debug-breakpoint-popup");
	await expect(popup).toBeVisible();
	const conditionInput = popup.locator(
		".plain-debug-breakpoint-popup-condition",
	);
	const logInput = popup.locator(".plain-debug-breakpoint-popup-log-message");
	await expect(conditionInput).toBeEnabled();
	await expect(logInput).toBeEnabled();

	// Meaningful interaction: typing a condition and saving re-syncs the
	// breakpoint with the live session — a real second `debug_set_breakpoints`
	// call carrying the real condition text, not just a local UI update.
	await conditionInput.fill("total > 5");
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
		path: "main.py",
		breakpoints: [{ line: 6, condition: "total > 5", logMessage: null }],
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
	await stepInButton.click();
	await expect
		.poll(async () => (await terminalCallsFor(page, "debug_step_in")).length)
		.toBe(1);
	expect(
		(await terminalCallsFor(page, "debug_step_in"))[0]!.args.request,
	).toEqual({ sessionId, threadId: 1 });
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
