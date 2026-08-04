import type {
	BackupEntry,
	CommandError,
	DebugAdapterConfirmationSubject,
	DebugAdapterTarget,
	DebugDisassembledInstruction,
	DebugEvaluateResult,
	DebugEventPayload,
	DebugScope,
	DebugSessionStartResult,
	DebugStackFrame,
	DebugStepInTarget,
	DebugVariable,
	GitBlameCommitHeader,
	GitBlameFileResult,
	GitBlameLineEntry,
	GitBlobRev,
	GitBranch,
	GitBranchDeleteOutcome,
	GitContributorsListResult,
	GitDiffFilesResult,
	GitHistoryEntry,
	GitHistoryListResult,
	GitHistoryMutationOutcome,
	GitHistoryOperation,
	GitHistoryPreview,
	GitHistoryState,
	GitLineHistoryDetail,
	GitLogGraphResult,
	GitNetworkPreviewResult,
	GitRefEntry,
	GitRefsListResult,
	GitReflogListResult,
	GitRemoteEntry,
	GitRemotesListResult,
	GitSequencerKind,
	GitShowCommitResult,
	GitStashEntry,
	GitStashListResult,
	GitStashShowResult,
	GitStatusEntry,
	GitStatusResult,
	GitWorktreeEntry,
	GitWorktreeListResult,
	NativeCloseRequest,
	PlainBridge,
	RemoteHostKeyListResult,
	RemoteSessionConnectResult,
	RemoteSessionEventPayload,
	RemoteSessionStateResult,
	RuntimeInfo,
	TerminalDataEvent,
	TerminalExitEvent,
	TerminalRgb,
	TerminalStyle,
	ThemeImportResult,
	ThemePackageSummary,
	UserDataChangedEvent,
	UserDataResource,
	UserDataResult,
	WorkspaceCapabilities,
	WorkspaceCommitDeleteEntryRequest,
	WorkspaceCommitTrashEntryRequest,
	WorkspaceDeleteBatchPlan,
	WorkspaceDeleteEntryKind,
	WorkspaceDeleteEntryRequest,
	WorkspaceDeleteIncompleteReason,
	WorkspaceDeleteResult,
	WorkspaceDirectoryEntry,
	WorkspaceEntryKind,
	WorkspaceMoveIncompleteReason,
	WorkspaceMoveResult,
	WorkspacePickSaveTargetResult,
	WorkspaceRecentEntry,
	WorkspaceRoot,
	WorkspaceSearchExpandReplacementItem,
	WorkspaceSearchFilesResult,
	WorkspaceTrashBatchPlan,
	WorkspaceTrashEntryRequest,
	WorkspaceTrashResult,
	WorkspaceWatchPendingRoot,
	WorkspaceWatchSyncRequest,
	WorkspaceWatchWakeEvent,
	WorkspaceWriteResult,
} from "./contracts";
import {
	frozenGitBlameCommitMessagesRequest,
	frozenGitBlameFileRequest,
	frozenGitBranchCreateRequest,
	frozenGitBranchDeleteRequest,
	frozenGitBranchRenameRequest,
	frozenGitBranchSwitchRequest,
	frozenGitCherryPickRequest,
	frozenGitCommitRequest,
	frozenGitDiffFilesRequest,
	frozenGitDiscardPathsRequest,
	frozenGitFileHistoryRequest,
	frozenGitHistoryAbortRequest,
	frozenGitHistoryContinueRequest,
	frozenGitHistoryPreviewRequest,
	frozenGitLineHistoryDetailRequest,
	frozenGitLineHistoryListRequest,
	frozenGitLogGraphRequest,
	frozenGitMergeRequest,
	frozenGitNetworkPreviewRequest,
	frozenGitPushRequest,
	frozenGitRebaseRequest,
	frozenGitRemoteAddRequest,
	frozenGitRemoteRemoveRequest,
	frozenGitRemoteRenameRequest,
	frozenGitRemoteSetUrlRequest,
	frozenGitResetRequest,
	frozenGitRevertRequest,
	frozenGitRootId,
	frozenGitShowBlobRequest,
	frozenGitShowBlobResult,
	frozenGitShowCommitBlobRequest,
	frozenGitShowCommitRequest,
	frozenGitStageBlobRequest,
	frozenGitStagePathsRequest,
	frozenGitStashApplyRequest,
	frozenGitStashDropRequest,
	frozenGitStashPopRequest,
	frozenGitStashPushRequest,
	frozenGitStashShowRequest,
	frozenGitTagCreateRequest,
	frozenGitTagDeleteRequest,
	frozenGitUnstagePathsRequest,
	frozenGitUpstreamSetRequest,
	frozenGitUpstreamUnsetRequest,
	frozenGitWorktreeAddRequest,
	frozenGitWorktreeRemoveRequest,
} from "./git-codec";
import {
	backupUnavailable,
	frozenBackupDiscardRequest,
	frozenBackupWriteInputs,
} from "./backup-codec";
import {
	frozenScratchDiscardRequest,
	frozenScratchWriteInputs,
} from "./scratch-codec";
import {
	decodeWorkspaceSearchTextStartResult,
	frozenWorkspaceSearchExpandReplacementsRequest,
	frozenWorkspaceSearchExpandReplacementsResult,
	frozenWorkspaceSearchFilesRequest,
	frozenWorkspaceSearchFilesResult,
	frozenWorkspaceSearchTextPollResult,
	frozenWorkspaceSearchTextStartRequest,
} from "./search-codec";
import {
	compareWorkspaceEntryNames,
	encodeWorkspacePublishFileRequest,
	encodeWorkspaceWriteFileRequest,
	frozenWorkspaceCommitDeleteEntryRequest,
	frozenWorkspaceCommitTrashEntryRequest,
	frozenWorkspaceCopyRequest,
	frozenWorkspaceDeleteBatchPlan,
	frozenWorkspaceDeleteBatchRequest,
	frozenWorkspaceDeleteResult,
	frozenWorkspaceEntryStat,
	frozenWorkspaceCreateEntryRequest,
	frozenWorkspaceEntryRequest,
	frozenWorkspaceReadFile,
	frozenWorkspaceMoveRequest,
	frozenWorkspaceMoveResult,
	frozenWorkspacePrepareDeleteRequest,
	frozenWorkspacePrepareTrashRequest,
	frozenWorkspaceTrashBatchPlan,
	frozenWorkspaceTrashBatchRequest,
	frozenWorkspaceTrashResult,
	frozenWorkspacePickResult,
	frozenWorkspacePickSaveTargetRequest,
	frozenWorkspacePickSaveTargetResult,
	frozenWorkspacePublishFileResult,
	frozenWorkspaceOpenFilesResult,
	frozenWorkspaceRecentListResult,
	frozenWorkspaceReadDirectory,
	frozenWorkspaceRenameRequest,
	frozenWorkspaceRecentRequest,
	frozenWorkspaceSnapshot,
	frozenWorkspaceWatchSyncRequest,
	frozenWorkspaceWriteResult,
	isPortableWorkspaceEntryName,
	decodeWorkspaceWatchSyncResult,
	decodeWorkspaceWatchWakeEvent,
	workspaceRelativePathSegments,
	workspaceWriteResponseUnavailable,
} from "./workspace-codec";
import {
	createWorkspaceWatcherManager,
	type WorkspaceWatcherTransport,
} from "./workspace-watcher";
import {
	decodeDebugAdapterConfirmationState,
	decodeDebugAdapterConfirmationVoid,
	frozenDebugAdapterConfirmationRequest,
	frozenDebugDisassembleRequest,
	frozenDebugEvaluateRequest,
	frozenDebugOutputAckRequest,
	frozenDebugScopesRequest,
	frozenDebugSessionIdRequest,
	frozenDebugSessionStartRequest,
	frozenDebugSetBreakpointsRequest,
	frozenDebugStackTraceRequest,
	frozenDebugStepInRequest,
	frozenDebugStepInTargetsRequest,
	frozenDebugThreadRequest,
	frozenDebugVariablesRequest,
} from "./debug-codec";
import {
	decodeTerminalLifecycleMarkerResult,
	decodeTerminalScrollbackResult,
	decodeTerminalStartResult,
	decodeTerminalProfilesResult,
	decodeWorkspaceTrustState,
	frozenTerminalAckRequest,
	frozenTerminalDataEvent,
	frozenTerminalExitEvent,
	frozenTerminalFocusRequest,
	frozenTerminalInputKeyRequest,
	frozenTerminalInputTextRequest,
	frozenTerminalKillRequest,
	frozenTerminalLifecycleMarkerRequest,
	frozenTerminalOpenExternalLinkRequest,
	frozenTerminalProfilesRequest,
	frozenTerminalResizeRequest,
	frozenTerminalScrollbackRequest,
	frozenTerminalStartRequest,
} from "./terminal-codec";

const runtimeInfo: RuntimeInfo = Object.freeze({
	application: "Plain",
	ipcVersion: 1,
	runtime: "browser-mock",
});

const workspaceCapabilities: WorkspaceCapabilities = Object.freeze({
	create: true,
	renameNoReplace: true,
	copyMove: true,
	delete: true,
	trash: true,
	versionedWrite: true,
});

const MOCK_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const MAX_DIRECTORY_COPY_DESCENDANTS = 10_000;
const MAX_DIRECTORY_COPY_NAME_BYTES = 1_024;
const MAX_DIRECTORY_COPY_NAME_PAYLOAD_BYTES = 2 * 1_024 * 1_024;
const MAX_DIRECTORY_COPY_DEPTH = 256;
const MAX_FILE_BYTES = 8 * 1_024 * 1_024;
const MAX_DIRECTORY_COPY_FILE_BYTES = 256 * 1_024 * 1_024;
const MAX_SYMLINK_PAYLOAD_BYTES = 4 * 1_024;
const MAX_DIRECTORY_COPY_SYMLINK_BYTES = 2 * 1_024 * 1_024;
const MAX_DIRECTORY_COPY_PATH_BYTES = 4 * 1_024;
const MAX_DIRECTORY_COPY_PATH_SEGMENTS = 256;
const MAX_MOCK_SYMLINK_DEPTH = 256;
const MAX_DELETE_BATCH_ENTRIES = 64;
const MAX_TRASH_BATCH_ENTRIES = 64;
const MAX_DELETE_DESCENDANTS = 10_000;
const MAX_DELETE_DEPTH = 256;
const MAX_DELETE_NAME_PAYLOAD_BYTES = 2 * 1_024 * 1_024;
const MAX_DELETE_SYMLINK_PAYLOAD_BYTES = 4 * 1_024;
const MAX_DELETE_SYMLINK_TOTAL_BYTES = 2 * 1_024 * 1_024;
const WORKSPACE_DELETE_IDLE_TTL_MS = 120_000;
const MAX_MOCK_SEARCH_TREE_ENTRIES = 50_000;
const MAX_MOCK_SEARCH_TREE_DEPTH = 256;
const MOCK_MTIME = 1_700_000_000_000;
const MOCK_CTIME = 1_699_999_000_000;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", {
	fatal: true,
	ignoreBOM: true,
});
const mockRoots = Object.freeze([
	Object.freeze({
		rootId: "00000000-0000-4000-8000-000000000101",
		displayName: "plain-workspace",
		uri: "plain-workspace://00000000-0000-4000-8000-000000000101/",
	}),
	Object.freeze({
		rootId: "00000000-0000-4000-8000-000000000102",
		displayName: "plain-library",
		uri: "plain-workspace://00000000-0000-4000-8000-000000000102/",
	}),
] satisfies readonly WorkspaceRoot[]);

interface MockFileNode {
	readonly kind: "file";
	readonly size: number;
	readonly bytes: Uint8Array;
}

interface MockDirectoryNode {
	readonly kind: "directory";
	readonly entries: Map<string, MockNode>;
}

interface MockImmutableBytes {
	readonly byteLength: number;
	readonly copy: () => Uint8Array;
}

interface MockSymlinkNode {
	readonly kind: "symlink";
	readonly payload: MockImmutableBytes;
}

interface MockUnsupportedNode {
	readonly kind: "other";
}

type MockNode =
	MockFileNode | MockDirectoryNode | MockSymlinkNode | MockUnsupportedNode;

interface DirectoryCopyLimits {
	readonly descendants: number;
	readonly entryNameBytes: number;
	readonly namePayloadBytes: number;
	readonly depth: number;
	readonly fileBytes: number;
	readonly totalFileBytes: number;
	readonly symlinkBytes: number;
	readonly totalSymlinkBytes: number;
	readonly pathBytes: number;
	readonly pathSegments: number;
}

interface WorkspaceDeleteLimits {
	readonly descendants: number;
	readonly depth: number;
	readonly namePayloadBytes: number;
	readonly symlinkBytes: number;
	readonly totalSymlinkBytes: number;
}

const DIRECTORY_COPY_LIMITS = Object.freeze({
	descendants: MAX_DIRECTORY_COPY_DESCENDANTS,
	entryNameBytes: MAX_DIRECTORY_COPY_NAME_BYTES,
	namePayloadBytes: MAX_DIRECTORY_COPY_NAME_PAYLOAD_BYTES,
	depth: MAX_DIRECTORY_COPY_DEPTH,
	fileBytes: MAX_FILE_BYTES,
	totalFileBytes: MAX_DIRECTORY_COPY_FILE_BYTES,
	symlinkBytes: MAX_SYMLINK_PAYLOAD_BYTES,
	totalSymlinkBytes: MAX_DIRECTORY_COPY_SYMLINK_BYTES,
	pathBytes: MAX_DIRECTORY_COPY_PATH_BYTES,
	pathSegments: MAX_DIRECTORY_COPY_PATH_SEGMENTS,
} satisfies DirectoryCopyLimits);

const WORKSPACE_DELETE_LIMITS = Object.freeze({
	descendants: MAX_DELETE_DESCENDANTS,
	depth: MAX_DELETE_DEPTH,
	namePayloadBytes: MAX_DELETE_NAME_PAYLOAD_BYTES,
	symlinkBytes: MAX_DELETE_SYMLINK_PAYLOAD_BYTES,
	totalSymlinkBytes: MAX_DELETE_SYMLINK_TOTAL_BYTES,
} satisfies WorkspaceDeleteLimits);

function mockFile(
	contents: string | readonly number[] | Uint8Array,
): MockFileNode {
	const bytes =
		typeof contents === "string"
			? textEncoder.encode(contents)
			: Uint8Array.from(contents);
	return Object.freeze({ kind: "file", size: bytes.byteLength, bytes });
}

function oversizedMockFile(): MockFileNode {
	return Object.freeze({
		kind: "file",
		size: MAX_FILE_BYTES + 1,
		bytes: new Uint8Array(),
	});
}

function immutableMockBytes(
	contents: string | readonly number[] | Uint8Array,
): MockImmutableBytes {
	const bytes =
		typeof contents === "string"
			? textEncoder.encode(contents)
			: Uint8Array.from(contents);
	return Object.freeze({
		byteLength: bytes.byteLength,
		copy: () => bytes.slice(),
	});
}

function mockSymlink(
	payload: string | readonly number[] | Uint8Array,
): MockSymlinkNode {
	return Object.freeze({
		kind: "symlink",
		payload: immutableMockBytes(payload),
	});
}

function mockUnsupportedNode(): MockUnsupportedNode {
	return Object.freeze({ kind: "other" });
}

function isMockSymlinkNode(node: MockNode): node is MockSymlinkNode {
	return node.kind === "symlink";
}

function mockSymlinkTargetSegments(
	linkParentSegments: readonly string[],
	link: MockSymlinkNode,
): readonly string[] | undefined {
	let target: string;
	try {
		target = textDecoder.decode(link.payload.copy());
	} catch {
		return undefined;
	}
	if (
		target.length === 0 ||
		target.startsWith("/") ||
		target.startsWith("\\") ||
		target.includes("\0") ||
		/^[A-Za-z]:/u.test(target)
	) {
		return undefined;
	}

	const resolved = [...linkParentSegments];
	for (const segment of target.split("/")) {
		if (segment.length === 0 || segment === ".") {
			continue;
		}
		if (segment === "..") {
			if (resolved.length === 0) {
				return undefined;
			}
			resolved.pop();
			continue;
		}
		resolved.push(segment);
	}
	return Object.freeze(resolved);
}

function resolveMockNodeFollowingSymlinks(
	root: MockDirectoryNode,
	segments: readonly string[],
	seen: ReadonlySet<MockSymlinkNode> = new Set(),
	depth = 0,
): MockNode | undefined {
	return resolveMockPathFollowingSymlinks(root, segments, seen, depth)?.node;
}

interface MockResolvedPath {
	readonly node: MockNode;
	readonly resolvedSegments: readonly string[];
	readonly followedSymlink: boolean;
	readonly finalSymlink?: MockSymlinkNode;
}

function resolveMockPathFollowingSymlinks(
	root: MockDirectoryNode,
	segments: readonly string[],
	seen: ReadonlySet<MockSymlinkNode> = new Set(),
	depth = 0,
): MockResolvedPath | undefined {
	if (depth > MAX_MOCK_SYMLINK_DEPTH) {
		return undefined;
	}

	let node: MockNode = root;
	const traversed: string[] = [];
	for (let index = 0; index < segments.length; index += 1) {
		if (node.kind !== "directory") {
			return undefined;
		}
		const segment = segments[index]!;
		const child = node.entries.get(segment);
		if (child === undefined) {
			return undefined;
		}
		if (isMockSymlinkNode(child)) {
			if (seen.has(child)) {
				return undefined;
			}
			const targetSegments = mockSymlinkTargetSegments(traversed, child);
			if (targetSegments === undefined) {
				return undefined;
			}
			const nextSeen = new Set(seen);
			nextSeen.add(child);
			const resolved = resolveMockPathFollowingSymlinks(
				root,
				[...targetSegments, ...segments.slice(index + 1)],
				nextSeen,
				depth + 1,
			);
			if (resolved === undefined) {
				return undefined;
			}
			return Object.freeze({
				node: resolved.node,
				resolvedSegments: resolved.resolvedSegments,
				followedSymlink: true,
				...(index === segments.length - 1
					? { finalSymlink: child }
					: resolved.finalSymlink === undefined
						? {}
						: { finalSymlink: resolved.finalSymlink }),
			});
		}
		node = child;
		traversed.push(segment);
	}
	return Object.freeze({
		node,
		resolvedSegments: Object.freeze([...traversed]),
		followedSymlink: false,
	});
}

function classifyMockNode(
	root: MockDirectoryNode,
	relativePath: string,
	node: MockNode,
): Readonly<{ kind: WorkspaceEntryKind; size: number }> {
	if (node.kind === "file") {
		return Object.freeze({ kind: "file", size: node.size });
	}
	if (!isMockSymlinkNode(node)) {
		return Object.freeze({ kind: node.kind, size: 0 });
	}

	const linkSegments = workspaceRelativePathSegments(relativePath);
	if (linkSegments === undefined || linkSegments.length === 0) {
		return Object.freeze({ kind: "symlink", size: node.payload.byteLength });
	}
	const targetSegments = mockSymlinkTargetSegments(
		linkSegments.slice(0, -1),
		node,
	);
	const target =
		targetSegments === undefined
			? undefined
			: resolveMockNodeFollowingSymlinks(root, targetSegments, new Set([node]));
	if (target?.kind === "file") {
		return Object.freeze({ kind: "symlinkFile", size: target.size });
	}
	if (target?.kind === "directory") {
		return Object.freeze({ kind: "symlinkDirectory", size: 0 });
	}
	return Object.freeze({ kind: "symlink", size: node.payload.byteLength });
}

function mockDirectory(
	entries: Readonly<Record<string, MockNode>>,
): MockDirectoryNode {
	const pairs = Object.entries(entries);
	if (
		pairs.length > 10_000 ||
		pairs.some(([name]) => !isPortableWorkspaceEntryName(name))
	) {
		throw new Error("Invalid bounded browser mock workspace tree.");
	}
	return Object.freeze({ kind: "directory", entries: new Map(pairs) });
}

const mockTreeTemplates = new Map<string, MockDirectoryNode>([
	[
		mockRoots[0]!.rootId,
		mockDirectory({
			".plainrc": mockFile('{"editor":"plain"}\n'),
			"README.md": mockFile("# Plain browser workspace\n"),
			"binary.bin": mockFile([0, 255, 128, 1, 0, 42]),
			empty: mockDirectory({}),
			fixtures: mockDirectory({
				"binary-link": mockSymlink([0xff, 0x80, 0x2f, 0x2e]),
				"dangling-link": mockSymlink("missing-target"),
				"directory-link": mockSymlink("../src"),
				"external-link": mockSymlink("../../outside-sentinel"),
				"file-link": mockSymlink("../README.md"),
				"loop-link": mockSymlink("loop-link"),
				"maximum-link": mockSymlink("x".repeat(MAX_SYMLINK_PAYLOAD_BYTES)),
				other: mockUnsupportedNode(),
				"oversized.bin": oversizedMockFile(),
				"oversized-link": mockSymlink(
					"x".repeat(MAX_SYMLINK_PAYLOAD_BYTES + 1),
				),
			}),
			src: mockDirectory({
				"main.ts": mockFile('export const editor = "Plain";\n'),
			}),
		}),
	],
	[
		mockRoots[1]!.rootId,
		mockDirectory({
			"notes.txt": mockFile("Library root\n"),
			packages: mockDirectory({}),
		}),
	],
]);

function cloneMockNode(node: MockNode): MockNode {
	if (node.kind === "file") {
		return Object.freeze({
			kind: "file",
			size: node.size,
			bytes: node.bytes.slice(),
		});
	}
	if (node.kind === "directory") {
		return Object.freeze({
			kind: "directory",
			entries: new Map(
				[...node.entries].map(([name, child]) => [name, cloneMockNode(child)]),
			),
		});
	}
	if (isMockSymlinkNode(node)) {
		return mockSymlink(node.payload.copy());
	}
	return mockUnsupportedNode();
}

function cloneMockTrees(): Map<string, MockDirectoryNode> {
	return new Map(
		[...mockTreeTemplates].map(([rootId, root]) => [
			rootId,
			cloneMockNode(root) as MockDirectoryNode,
		]),
	);
}

/**
 * A deliberately simplified `.gitignore` line: this mock exists so Browser
 * E2E fixtures can drop a `.gitignore` file into the tree and see file
 * search honor it, not to re-implement gitignore's full glob grammar. Rust
 * (`src-tauri/src/search/file_search.rs`) is the sole semantic authority;
 * this only supports what the fixtures actually need: exact names,
 * `*.ext` suffix globs, one literal path segment, negation (`!`), and a
 * trailing `/` for directory-only rules.
 */
interface MockGitignoreRule {
	readonly negate: boolean;
	readonly dirOnly: boolean;
	readonly pattern: string;
}

interface MockGitignoreLayer {
	readonly wire: string;
	readonly rules: readonly MockGitignoreRule[];
}

function parseMockGitignoreRules(
	content: string,
): readonly MockGitignoreRule[] {
	return content
		.split("\n")
		.map((line) => line.replace(/\r$/, "").trim())
		.filter((line) => line.length > 0 && !line.startsWith("#"))
		.map((line): MockGitignoreRule => {
			const negate = line.startsWith("!");
			const withoutBang = negate ? line.slice(1) : line;
			const dirOnly = withoutBang.endsWith("/");
			const pattern = dirOnly ? withoutBang.slice(0, -1) : withoutBang;
			return Object.freeze({ negate, dirOnly, pattern });
		});
}

function mockGitignoreRuleMatches(
	rule: MockGitignoreRule,
	relativeToLayer: string,
	isDir: boolean,
): boolean {
	if (rule.dirOnly && !isDir) {
		return false;
	}
	if (rule.pattern.includes("/")) {
		return (
			relativeToLayer === rule.pattern ||
			relativeToLayer.startsWith(`${rule.pattern}/`)
		);
	}
	const segments = relativeToLayer.split("/");
	const basename = segments.at(-1) ?? relativeToLayer;
	if (rule.pattern.startsWith("*.")) {
		return basename.endsWith(rule.pattern.slice(1));
	}
	return basename === rule.pattern || segments.includes(rule.pattern);
}

function mockGitignoreLayerFor(
	directory: MockDirectoryNode,
	wire: string,
): MockGitignoreLayer {
	const gitignoreNode = directory.entries.get(".gitignore");
	let rules: readonly MockGitignoreRule[] = [];
	if (gitignoreNode !== undefined && gitignoreNode.kind === "file") {
		try {
			rules = parseMockGitignoreRules(textDecoder.decode(gitignoreNode.bytes));
		} catch {
			rules = [];
		}
	}
	return Object.freeze({ wire, rules });
}

/**
 * Walks the `.gitignore` chain from most specific (deepest directory) to
 * least specific (the search root), mirroring
 * `search::file_search::matched_gitignore`'s precedence: the first layer
 * with an opinion (ignore or negated re-include) wins.
 */
function mockPathIsGitignored(
	chain: readonly MockGitignoreLayer[],
	wire: string,
	isDir: boolean,
): boolean {
	for (let index = chain.length - 1; index >= 0; index -= 1) {
		const layer = chain[index]!;
		const relative =
			layer.wire.length === 0 ? wire : wire.slice(layer.wire.length + 1);
		let matched: boolean | undefined;
		for (const rule of layer.rules) {
			if (mockGitignoreRuleMatches(rule, relative, isDir)) {
				matched = !rule.negate;
			}
		}
		if (matched !== undefined) {
			return matched;
		}
	}
	return false;
}

/**
 * A deliberately small glob subset for mock `excludeGlobs`: `**\/name` (any
 * depth), `**\/name/**` (anywhere under a directory named `name`), or a
 * literal full-path match. Sufficient for E2E fixtures; Rust's `globset`
 * matcher is the real implementation.
 */
function compileMockExcludeGlob(pattern: string): (wire: string) => boolean {
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
}

/** Cheap, non-scoring case-insensitive subsequence test; mirrors Rust's
 * `is_subsequence` prefilter (both callers already lowercase their inputs). */
function isMockSubsequence(pattern: string, haystack: string): boolean {
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
}

export type BrowserMockWorkspacePick = "selected" | "cancelled";
export type BrowserMockWorkspaceFilePick = "selected" | "cancelled";
export type BrowserMockWorkspaceSavePick =
	| Readonly<{ status: "cancelled" }>
	| Readonly<{
			status: "selected";
			/** Selects one of the two deterministic mock parent directories. */
			rootIndex?: 0 | 1;
			/** File name within that selected parent directory. */
			name?: string;
	  }>;

export interface BrowserMockDirectoryCopyLimitsForTest {
	readonly descendants?: number;
	readonly entryNameBytes?: number;
	readonly namePayloadBytes?: number;
	readonly depth?: number;
	readonly fileBytes?: number;
	readonly totalFileBytes?: number;
	readonly symlinkBytes?: number;
	readonly totalSymlinkBytes?: number;
	readonly pathBytes?: number;
	readonly pathSegments?: number;
}

interface BrowserMockDirectoryFixtureEntryBaseForTest {
	readonly path: readonly string[];
}

export type BrowserMockDirectoryFixtureEntryForTest =
	| (BrowserMockDirectoryFixtureEntryBaseForTest & {
			readonly kind: "directory";
	  })
	| (BrowserMockDirectoryFixtureEntryBaseForTest & {
			readonly kind: "other";
	  })
	| (BrowserMockDirectoryFixtureEntryBaseForTest & {
			readonly kind: "file";
			readonly bytes: readonly number[] | Uint8Array;
	  })
	| (BrowserMockDirectoryFixtureEntryBaseForTest & {
			readonly kind: "symlink";
			readonly payload: readonly number[] | Uint8Array;
	  })
	| (BrowserMockDirectoryFixtureEntryBaseForTest & {
			readonly kind: "hardlink";
			/** Path relative to the injected fixture root. */
			readonly targetPath: readonly string[];
	  });

export interface BrowserMockDirectoryFixtureForTest {
	/** A direct child of the first deterministic mock root. */
	readonly name: string;
	/** Flat, parent-before-child-independent descendants of the fixture root. */
	readonly entries: readonly BrowserMockDirectoryFixtureEntryForTest[];
}

export interface BrowserMockDirectoryCopyManifestEntrySummary {
	readonly relativePath: string;
	readonly kind: "directory" | "file" | "symlink";
	readonly depth: number;
	readonly size: number;
	readonly payload?: readonly number[];
}

export interface BrowserMockDirectoryCopyManifestSummary {
	readonly descendants: number;
	readonly maximumDepth: number;
	readonly namePayloadBytes: number;
	readonly logicalFileBytes: number;
	readonly actualFileBytes: number;
	readonly symlinkPayloadBytes: number;
	readonly entries: readonly BrowserMockDirectoryCopyManifestEntrySummary[];
}

export interface BrowserMockDirectoryCopyObservation {
	readonly sourceRootId: string;
	readonly sourcePath: string;
	readonly targetRootId: string;
	readonly targetPath: string;
	readonly manifest: BrowserMockDirectoryCopyManifestSummary;
}

export interface BrowserMockSymlinkCopyObservation {
	readonly sourceRootId: string;
	readonly sourcePath: string;
	readonly targetRootId: string;
	readonly targetPath: string;
	readonly payload: readonly number[];
}

export interface BrowserMockWorkspaceMoveObservation {
	readonly sourceRootId: string;
	readonly sourcePath: string;
	readonly targetRootId: string;
	readonly targetPath: string;
	readonly sourceKind: "file" | "directory" | "symlink";
	readonly removedEntries: number;
}

export interface BrowserMockWorkspaceMoveDeletedEntryObservation extends BrowserMockWorkspaceMoveObservation {
	readonly relativePath: string;
	readonly kind: "file" | "directory" | "symlink";
}

export interface BrowserMockWorkspaceMoveDeleteObservation extends BrowserMockWorkspaceMoveObservation {
	/** Empty for the top-level source entry. */
	readonly relativePath: string;
	readonly kind: "file" | "directory" | "symlink";
}

export type BrowserMockWorkspaceMoveSeamResult = Exclude<
	WorkspaceMoveIncompleteReason,
	"deleteFailed"
> | void;

export interface BrowserMockWorkspaceMoveMutationsForTest {
	rewriteSourceFile(relativePath: string, bytes: readonly number[]): void;
	rewriteTargetFile(relativePath: string, bytes: readonly number[]): void;
}

export interface BrowserMockWorkspaceDeleteLimitsForTest {
	readonly descendants?: number;
	readonly depth?: number;
	readonly namePayloadBytes?: number;
	readonly symlinkBytes?: number;
	readonly totalSymlinkBytes?: number;
}

export interface BrowserMockWorkspaceDeleteObservation {
	readonly confirmationId: string;
	readonly phase: "prepared" | "begin" | "beforeRemove" | "afterRemove";
	readonly entryIndex?: number;
	readonly kind?: WorkspaceDeleteEntryKind;
	readonly descendantEntries?: number;
	readonly removedEntries: number;
	readonly isRoot?: boolean;
}

export interface BrowserMockWorkspaceDeleteMutationsForTest {
	rewriteFile(
		rootId: string,
		relativePath: string,
		bytes: readonly number[],
	): void;
	replaceFile(
		rootId: string,
		relativePath: string,
		bytes: readonly number[],
	): void;
	addFile(rootId: string, relativePath: string, bytes: readonly number[]): void;
	addHardlink(rootId: string, sourcePath: string, targetPath: string): void;
	removeEntry(rootId: string, relativePath: string): void;
	chmod(rootId: string, relativePath: string, mode: number): void;
}

export interface BrowserMockWorkspaceWriteObservation {
	readonly phase:
		"beforePublication" | "rename" | "directorySync" | "afterPublication";
	readonly rootId: string;
	readonly relativePath: string;
	readonly expectedVersion: string;
	readonly contentLength: number;
}

export interface BrowserMockWorkspaceWriteMutationsForTest {
	rewriteTarget(bytes: readonly number[]): void;
	replaceTarget(bytes: readonly number[]): void;
	rewriteStage(bytes: readonly number[]): void;
	replaceStage(bytes: readonly number[]): void;
	changeAncestor(): void;
	publishStage(): void;
	markTargetUnverifiable(): void;
	revokeRoot(): void;
	closeWindow(): void;
}

export type BrowserMockWorkspaceWriteRenameResult =
	"reportedSuccess" | "reportedFailure" | void;
export type BrowserMockWorkspaceWriteDirectorySyncResult =
	"synced" | "failed" | void;
export type BrowserMockWorkspaceWriteTargetResult =
	"matchesWritten" | "changed" | "unverifiable" | void;

export interface BrowserMockWorkspaceWatchInvalidationForTest {
	/** False simulates a lost/coalesced native wake; the manager timer must recover. */
	readonly emitWake?: boolean;
	readonly rescanRequired?: boolean;
}

/**
 * Browser-only, path-free seam for exercising external filesystem changes.
 * It deliberately accepts a root id rather than a resource or native path.
 */
export interface BrowserMockWorkspaceWatchControllerForTest {
	invalidateRoot(
		rootId: string,
		options?: BrowserMockWorkspaceWatchInvalidationForTest,
	): void;
}

/**
 * Deterministic seed for the browser-mock backup store, injected before any
 * interaction. Simulates content a previous session left on disk (the
 * production Rust store's actual restart-persistence is out of scope for a
 * browser-only mock).
 */
export interface BrowserMockBackupSeedEntryForTest {
	readonly rootId: string;
	readonly key: string;
	readonly bytes: readonly number[];
}

/**
 * A pre-validated theme package the browser mock exposes as if it had
 * already gone through the real Rust unpack/validate/import pipeline — the
 * mock never re-implements zip/JSONC/include-chain parsing (109 real Rust
 * tests already cover that), it only exercises the frontend's own
 * consumption (registerExtension/registerFileUrl wiring, registry/picker
 * updates, toast feedback). `resourceContents` must have exactly one entry
 * per `summary.resources` path (UTF-8 text, matching every resource this
 * slice ever whitelists: theme JSON and `.tmTheme` documents).
 */
export interface BrowserMockThemePackageFixture {
	readonly summary: ThemePackageSummary;
	readonly resourceContents: Readonly<Record<string, string>>;
}

/** One scripted `theme_import_vsix`/`theme_import_directory` outcome,
 * consumed in order (like `workspacePicks`) — the mock file/folder picker
 * itself is never simulated byte-for-byte, only its end result. */
export type BrowserMockThemeImportOutcome =
	| Readonly<{ status: "cancelled" }>
	| Readonly<{ status: "imported"; fixture: BrowserMockThemePackageFixture }>;

/**
 * `F220` S1: scripts what `remoteSessionConnect`/`remoteHostKeyConfirm`'s
 * post-host-key-check phase (agent authentication) does once a target's host
 * key has been accepted — either because a matching pin already existed, or
 * because a `remoteHostKeyConfirm` call just pinned it. Keyed by
 * `"host:port"` (see `remoteMockTargetKey` in the mock body); a target with
 * no entry always succeeds. Mirrors every other per-target scripted-outcome
 * fixture in this file (e.g. `BrowserMockGitNetworkFixtureForTest`'s own
 * shape for a different domain).
 */
export type BrowserMockRemoteConnectOutcomeForTest =
	"success" | "authRejected" | "connectTimedOut";

/**
 * `F220` S1's own scriptable fixture — the mock keeps its own tiny
 * in-memory known-hosts pin store (never the real Rust one), seeded by
 * `pinnedHostsForTest` and otherwise built up as `remoteHostKeyConfirm` is
 * called during the test, exactly mirroring `TrustService`'s own
 * "start empty, callers grant" shape for a different domain.
 */
export interface BrowserMockRemoteFixtureForTest {
	/** Pre-seeds the mock's pin store, as if these targets had already been
	 * confirmed in an earlier session — a fresh `remoteSessionConnect` call
	 * against one of these resolves straight to `"connected"` (or whatever
	 * `connectOutcomesForTest` scripts), never `"hostKeyPendingConfirmation"`. */
	readonly pinnedHostsForTest?: readonly Readonly<{
		host: string;
		port: number;
	}>[];
	/** Keyed by `"host:port"`. */
	readonly connectOutcomesForTest?: Readonly<
		Record<string, BrowserMockRemoteConnectOutcomeForTest>
	>;
	/** `"host:port"` targets whose live host key the mock reports as having
	 * *changed* since it was pinned — simulates a reinstalled host or a
	 * man-in-the-middle, exercising the ADR 0006 §3 hard-fail-no-bypass path.
	 * Only meaningful for a target also present in `pinnedHostsForTest` (or
	 * pinned earlier in the same test via a real `remoteHostKeyConfirm`
	 * call); a target that has never been pinned always reports
	 * `"hostKeyPendingConfirmation"` regardless of this list. */
	readonly changedHostKeyTargetsForTest?: readonly string[];
}

export interface BrowserMockBridgeOptions {
	/** Captures a fixed same-application new-window request without letting
	 * tests inject a URL, label, capability scope, or browser feature string. */
	readonly onWindowCreateForTest?: () => void;
	readonly workspacePicks?: readonly BrowserMockWorkspacePick[];
	readonly workspaceFilePicks?: readonly BrowserMockWorkspaceFilePick[];
	readonly workspaceSavePicks?: readonly BrowserMockWorkspaceSavePick[];
	/** Seeds the isolated in-memory backup store before first use. */
	readonly backupFixtureForTest?: readonly BrowserMockBackupSeedEntryForTest[];
	/** Seeds the isolated in-memory theme library before first use — as if
	 * these packages had already been imported in a previous session. */
	readonly themeLibraryFixtureForTest?: readonly BrowserMockThemePackageFixture[];
	/** Consumed in order by `themeImportVsix`/`themeImportDirectory`; an
	 * empty queue falls back to `{ status: "cancelled" }`. */
	readonly themeImportOutcomesForTest?: readonly BrowserMockThemeImportOutcome[];
	/** Seeds the isolated in-memory theme selection before first use — as if
	 * `theme_set_selection` had already persisted this value (or `null`/
	 * omitted for "nothing persisted yet") in a previous session. Consumed by
	 * `themeGetSelection`; every later `themeSetSelection` call replaces it,
	 * matching the real Rust store's own overwrite/clear semantics. */
	readonly themeSelectionForTest?: string | null;
	/** `F060` S3: the file icon theme axis analogue of
	 * `themeSelectionForTest` — seeds the in-memory `fileIconThemeId`
	 * returned by `themeGetSelection`, independent of the color axis. */
	readonly fileIconThemeSelectionForTest?: string | null;
	/** `F060` S3: the product icon theme axis analogue. */
	readonly productIconThemeSelectionForTest?: string | null;
	/** Browser-mock only bounded tree injected below the first mock root. */
	readonly directoryCopyFixtureForTest?: BrowserMockDirectoryFixtureForTest;
	/** May only lower production directory-copy budgets. */
	readonly directoryCopyLimitsForTest?: BrowserMockDirectoryCopyLimitsForTest;
	/** Browser-mock test seam; runs before the single target-map publication. */
	readonly onDirectoryCopyForTest?: (
		observation: BrowserMockDirectoryCopyObservation,
	) => void;
	/** Browser-mock test seam; receives a frozen, detached payload copy. */
	readonly onSymlinkCopyForTest?: (
		observation: BrowserMockSymlinkCopyObservation,
	) => void;
	/** Runs after the detached target is published and before receipt checks. */
	readonly onWorkspaceMoveAfterPublicationForTest?: (
		observation: BrowserMockWorkspaceMoveObservation,
		mutations: BrowserMockWorkspaceMoveMutationsForTest,
	) => BrowserMockWorkspaceMoveSeamResult;
	/** Runs after source-first dual receipt checks and before source deletion. */
	readonly onWorkspaceMoveBeforeDeleteForTest?: (
		observation: BrowserMockWorkspaceMoveObservation,
		mutations: BrowserMockWorkspaceMoveMutationsForTest,
	) => BrowserMockWorkspaceMoveSeamResult;
	/** Runs after each successfully deleted directory descendant. */
	readonly onWorkspaceMoveAfterDeleteEntryForTest?: (
		observation: BrowserMockWorkspaceMoveDeletedEntryObservation,
		mutations: BrowserMockWorkspaceMoveMutationsForTest,
	) => BrowserMockWorkspaceMoveSeamResult;
	/** Throws only at the simulated remove syscall to inject deleteFailed. */
	readonly onWorkspaceMoveDeleteForTest?: (
		observation: BrowserMockWorkspaceMoveDeleteObservation,
	) => void;
	/** Counts private receipt-node comparisons for complexity assertions only. */
	readonly onWorkspaceMoveReceiptVisitForTest?: () => void;
	/** May only lower the production delete namespace/link budgets. */
	readonly workspaceDeleteLimitsForTest?: BrowserMockWorkspaceDeleteLimitsForTest;
	/** Injectable monotonic millisecond clock for delete batch expiry tests. */
	readonly workspaceDeleteClockForTest?: () => number;
	/** Scripted system-Trash terminal results; default commits are `trashed`. */
	readonly workspaceTrashResultsForTest?: readonly WorkspaceTrashResult[];
	/** Runs after a private receipt exists and before prepare's second pass. */
	readonly onWorkspaceDeletePreparedForTest?: (
		observation: BrowserMockWorkspaceDeleteObservation,
		mutations: BrowserMockWorkspaceDeleteMutationsForTest,
	) => void;
	/** Runs immediately before begin's whole-batch zero-remove preflight. */
	readonly onWorkspaceDeleteBeginForTest?: (
		observation: BrowserMockWorkspaceDeleteObservation,
		mutations: BrowserMockWorkspaceDeleteMutationsForTest,
	) => void;
	/** Runs before each receipt-owned remove and may mutate only the mock model. */
	readonly onWorkspaceDeleteBeforeRemoveForTest?: (
		observation: BrowserMockWorkspaceDeleteObservation,
		mutations: BrowserMockWorkspaceDeleteMutationsForTest,
	) => void;
	/** Runs after each successfully removed descendant, never after the root. */
	readonly onWorkspaceDeleteAfterRemoveForTest?: (
		observation: BrowserMockWorkspaceDeleteObservation,
		mutations: BrowserMockWorkspaceDeleteMutationsForTest,
	) => void;
	/** Throws at the simulated remove syscall to inject deleteFailed. */
	readonly onWorkspaceDeleteRemoveForTest?: (
		observation: BrowserMockWorkspaceDeleteObservation,
	) => void;
	/** Counts private delete receipt comparisons for complexity assertions only. */
	readonly onWorkspaceDeleteReceiptVisitForTest?: () => void;
	/** Runs after the staged receipt exists and before final pre-publication checks. */
	readonly onWorkspaceWriteBeforePublicationForTest?: (
		observation: BrowserMockWorkspaceWriteObservation,
		mutations: BrowserMockWorkspaceWriteMutationsForTest,
	) => void;
	/** Simulates the one rename syscall report; publication is a separate mutation. */
	readonly onWorkspaceWriteRenameForTest?: (
		observation: BrowserMockWorkspaceWriteObservation,
		mutations: BrowserMockWorkspaceWriteMutationsForTest,
	) => BrowserMockWorkspaceWriteRenameResult;
	/** Simulates parent-directory synchronization after a possible publication. */
	readonly onWorkspaceWriteDirectorySyncForTest?: (
		observation: BrowserMockWorkspaceWriteObservation,
		mutations: BrowserMockWorkspaceWriteMutationsForTest,
	) => BrowserMockWorkspaceWriteDirectorySyncResult;
	/** Runs before the current-root target observation is classified. */
	readonly onWorkspaceWriteAfterPublicationForTest?: (
		observation: BrowserMockWorkspaceWriteObservation,
		mutations: BrowserMockWorkspaceWriteMutationsForTest,
	) => BrowserMockWorkspaceWriteTargetResult;
	/** Captures the path-free external-change seam for watcher acceptance tests. */
	readonly onWorkspaceWatchControllerForTest?: (
		controller: BrowserMockWorkspaceWatchControllerForTest,
	) => void;
	/** Lowers the streaming text search match budget so `limitHit` is
	 * reachable with a small fixture instead of 20,000 real matches. */
	readonly textSearchMaxMatchesForTest?: number;
	/** How many batches `workspaceSearchTextPoll` delivers per call; defaults
	 * to 1 so tests can observe genuine multi-poll streaming instead of
	 * everything arriving in a single response. */
	readonly textSearchBatchesPerPollForTest?: number;
	/** Initial execution-trust state for the current (non-empty) workspace;
	 * defaults to `false`, matching the real `TrustService`'s own "granted
	 * trust does not carry over automatically" semantics. Always reported
	 * `false` regardless of this value whenever there is no open root —
	 * mirrors `TrustService::is_trusted`'s `EMPTY`-workspace short-circuit. */
	readonly terminalTrustedForTest?: boolean;
	/** Runs once per `terminalStart` call, handing the caller a controller
	 * scoped to *that* session so tests/E2E can inject extra output, force a
	 * resize, simulate exit, and inspect the frame emission credit gate —
	 * see `BrowserMockTerminalSessionController`. */
	readonly onTerminalSessionForTest?: (
		controller: BrowserMockTerminalSessionController,
	) => void;
	/** F190 S4 "Ghostty metadata and links": invoked once per accepted
	 * `terminalOpenExternalLink` call with the exact URL it validated — lets
	 * a test assert *which* URL a Cmd/Ctrl+Click on a rendered hyperlink
	 * actually requested opening, without this mock needing to simulate a
	 * real OS opener process. */
	readonly onTerminalOpenExternalLinkForTest?: (url: string) => void;
	/** `F080` S1: seeds the deterministic `gitStatus`/`gitDiffFiles`/
	 * `gitShowBlob` responses — see `BrowserMockGitFixtureForTest`. */
	readonly gitFixtureForTest?: BrowserMockGitFixtureForTest;
	/** `F100` S3: seeds the deterministic `debug_launch`/`debug_attach`/
	 * `debug_set_breakpoints`/`debug_stack_trace`/`debug_scopes`/
	 * `debug_variables`/`debug_evaluate` responses — see
	 * `BrowserMockDebugFixtureForTest`. */
	readonly debugFixtureForTest?: BrowserMockDebugFixtureForTest;
	/** Runs once per `debugLaunch`/`debugAttach` call, handing the caller a
	 * controller scoped to *that* session so tests/E2E can push synthetic DAP
	 * events (`stopped`, `continued`, `output`, …) and simulate the transport
	 * closing — see `BrowserMockDebugSessionController`. */
	readonly onDebugSessionForTest?: (
		controller: BrowserMockDebugSessionController,
	) => void;
	/** `F220` S1: seeds the mock's own in-memory SSH known-hosts pin store
	 * and scripts post-host-key-check connect outcomes — see
	 * `BrowserMockRemoteFixtureForTest`. */
	readonly remoteFixtureForTest?: BrowserMockRemoteFixtureForTest;
}

/**
 * Deterministic, injectable `git_status`/`git_diff_files`/`git_show_blob`
 * responses for the browser mock (`F080` S1) — this mock never re-implements
 * porcelain-v2/numstat parsing (the real Rust parsers already have thorough
 * fixture coverage in `src-tauri/src/git/status/tests.rs`/
 * `src-tauri/src/git/diff/tests.rs`); it only exists so a consuming frontend
 * (`PlainScmProvider`, `F080` S2) has structurally correct, scriptable
 * responses to develop and test against, gated by the same shared
 * workspace-trust flag `terminalTrustedForTest` already models (git and
 * terminal share one `TrustService` in the real Rust implementation, so the
 * mock does not model a second, independent trust flag).
 */
export interface BrowserMockGitFixtureForTest {
	/** Defaults to a clean repository on branch `"main"` with no upstream and
	 * no entries. */
	readonly status?: GitStatusResult;
	/** Defaults to `{ entries: [] }` for whichever of `cached`/`worktree` is
	 * omitted. */
	readonly diffFiles?: Readonly<{
		readonly cached?: GitDiffFilesResult;
		readonly worktree?: GitDiffFilesResult;
	}>;
	/** Keyed by repository-toplevel-relative path, then by `GitBlobRev`; a
	 * missing rev for an otherwise-present path key (or a missing path key
	 * entirely) means "no such version" (`{ content: null }`), matching the
	 * real `git_show_blob` not-found outcome — never a rejection. Values are
	 * UTF-8 text, encoded to bytes by the mock. */
	readonly blobs?: Readonly<
		Record<string, Partial<Record<GitBlobRev, string>>>
	>;
	/** `F090` S0: seeds the deterministic `gitBlameFile` response, keyed by
	 * repository-toplevel-relative path — a missing path key defaults to
	 * `{ entries: [], commits: {} }` (an empty, harmless default, mirroring
	 * `diffFiles`'s own `defaultGitDiffFiles`). Unlike the real Rust parser,
	 * this mock never re-implements `--line-porcelain` parsing (the real
	 * parser's fixture coverage lives in
	 * `src-tauri/src/git/blame/tests.rs`); it only exists so a consuming
	 * frontend has structurally correct, scriptable responses to develop and
	 * test the inline-blame/hover/age-heatmap UI against. A `gitBlameFile`
	 * call with a non-null `range` filters the seeded fixture's own entries
	 * down to `finalLine` within `[start, end]` — real range-scoped `-L`
	 * blame is otherwise unmodeled. */
	readonly blame?: Readonly<Record<string, GitBlameFileResult>>;
	/** `F090` S0: seeds the deterministic `gitBlameCommitMessages` response,
	 * keyed by commit sha -> full message body. A sha with no fixture entry
	 * is simply absent from the response's `messages` map (this mock has no
	 * real commit history to validate a sha against, unlike the real
	 * `git log` call, which would reject an unknown sha outright — see
	 * `src-tauri/src/git/blame.rs`'s `blame_commit_messages` doc comment). */
	readonly blameCommitMessages?: Readonly<Record<string, string>>;
	/** `F090` S1: seeds the deterministic `gitFileHistory` response, keyed by
	 * repository-toplevel-relative path — a missing path key defaults to
	 * `{ entries: [], truncated: false }`. Like `blame` above, this mock never
	 * re-implements `git log --follow`'s own rename-heuristic traversal (the
	 * real parser's thorough fixture coverage, including its rename fixture,
	 * lives in `src-tauri/src/git/log/tests.rs`); it only exists so a
	 * consuming frontend has structurally correct, scriptable responses to
	 * develop and test the history sidebar against. */
	readonly fileHistory?: Readonly<Record<string, GitHistoryListResult>>;
	/** `F090` S1: seeds the deterministic `gitLineHistoryList` response, keyed
	 * by path only (a missing path key defaults to `{ entries: [], truncated:
	 * false }`) — unlike the real `-L<range>` command, this mock has no real
	 * per-line git history to slice, so the same fixture is returned
	 * regardless of the requested range. */
	readonly lineHistoryList?: Readonly<Record<string, GitHistoryListResult>>;
	/** `F090` S1: seeds the deterministic `gitLineHistoryDetail` response,
	 * keyed by commit sha (the sha a `lineHistoryList` entry reports) — a sha
	 * with no fixture entry falls back to a synthesized minimal `diffText`
	 * (`commit <sha>\n\n    <message>\n`) built from that same
	 * `lineHistoryList` entry, so a caller does not need to seed both maps
	 * just to exercise the click-through flow. `gitLineHistoryDetail` still
	 * enforces the real `skip`/`expectedSha` contract against whatever
	 * `lineHistoryList` fixture is seeded (`GIT_LINE_HISTORY_DETAIL_NOT_FOUND`/
	 * `GIT_LINE_HISTORY_DETAIL_STALE_INDEX`), exactly like the real Rust
	 * implementation. */
	readonly lineHistoryDetail?: Readonly<Record<string, GitLineHistoryDetail>>;
	/** `F090` S2: seeds the deterministic `gitShowCommit` response, keyed by
	 * commit sha — a missing sha key defaults to `{ sha: <requested>,
	 * parentSha: null, files: [] }` (an empty, harmless default, mirroring
	 * `blame`'s own `defaultGitBlameFile` precedent). This mock never
	 * re-implements the real two-explicit-revision `git diff`/empty-tree
	 * resolution (the real Rust parser's thorough fixture coverage, including
	 * its clean-merge control groups, lives in
	 * `src-tauri/src/git/show_commit/tests.rs`); it only exists so a
	 * consuming frontend (the multi-diff commit-detail resolver) has
	 * structurally correct, scriptable responses to develop and test
	 * against. */
	readonly showCommit?: Readonly<Record<string, GitShowCommitResult>>;
	/** `F090` S2: seeds the deterministic `gitShowCommitBlob` response, keyed
	 * by commit sha and then by repository-toplevel-relative path — a missing
	 * sha or path key means "no such version" (`{ content: null }`), matching
	 * `gitShowCommitBlob`'s real not-found outcome (never a rejection),
	 * mirroring `blobs`'s own convention for `gitShowBlob`. Values are UTF-8
	 * text, encoded to bytes by the mock. */
	readonly commitBlobs?: Readonly<
		Record<string, Readonly<Record<string, string>>>
	>;
	/** `F090` S3: seeds the deterministic `gitLogGraph` response, returned
	 * regardless of the requested `maxCount` (defaults to `{ nodes: [],
	 * truncated: false }`) — like `blame`/`fileHistory` above, this mock never
	 * re-implements the real `--topo-order` DAG walk or swimlane assignment
	 * (the real Rust parser's thorough fixture coverage, including its
	 * octopus-merge fixture, lives in `src-tauri/src/git/log/tests.rs`; the
	 * frontend swimlane layout algorithm's own coverage lives in
	 * `plain-git-graph-layout.test.ts`); it only exists so a consuming
	 * frontend has structurally correct, scriptable responses to develop and
	 * test the graph view against. */
	readonly graphForTest?: GitLogGraphResult;
	/** `F090` S3: seeds the deterministic `gitRefsList` response (defaults to
	 * `{ entries: [], truncated: false }`) — same "structurally correct
	 * fixture, not a re-implementation" scope as `graphForTest` above (the
	 * real Rust parser's thorough fixture coverage lives in
	 * `src-tauri/src/git/refs/tests.rs`). */
	readonly refsForTest?: GitRefsListResult;
	/** `F180` S1A: structurally correct, already-redacted remote inventory. */
	readonly remotesForTest?: GitRemotesListResult;
	/** `F180` S1A: bounded HEAD reflog fixture, newest first. */
	readonly reflogForTest?: GitReflogListResult;
	/** `F180` S1A: aggregated contributor fixture. */
	readonly contributorsForTest?: GitContributorsListResult;
	/** `F180` S1B: local branch short names whose first safe deletion probe
	 * reports `needsForce`; a confirmed `force: true` retry removes them. */
	readonly branchUnmergedForTest?: readonly string[];
	/** `F180` S3: optional deterministic conflict paths for one history
	 * operation. Rust real-Git fixtures remain authoritative; this only lets
	 * a later frontend workflow exercise Continue/Abort rendering. */
	readonly historyConflictForTest?: Partial<
		Readonly<Record<GitHistoryOperation, readonly string[]>>
	>;
	/** `F090` S4: seeds the initial, mutable `gitStashList` state (defaults to
	 * `[]`) — `gitStashPush`/`gitStashApply`/`gitStashPop`/`gitStashDrop` all
	 * mutate this in place (unshift on push, splice on a successful pop/drop),
	 * mirroring `gitEntries`'s own "mutable simulation, not a re-implementation
	 * of real git plumbing" scope for `F080` S3's stage/commit/discard mock —
	 * the real Rust parser's thorough fixture coverage (including the
	 * index-shift race and the hostile-message field-safety proof) lives in
	 * `src-tauri/src/git/stash/tests.rs`; this mock only exists so a consuming
	 * frontend has structurally correct, scriptable responses to develop and
	 * test the stash panel against. `index` on each seeded entry is ignored
	 * (recomputed from array position on every `gitStashList` call, exactly
	 * like the real Rust `%gd` invariant). */
	readonly stashForTest?: readonly GitStashEntry[];
	/** `F090` S4: seeds the deterministic `gitStashShow` response, keyed by
	 * stash sha — a sha present in `stashForTest` but missing here defaults to
	 * `{ sha, parentSha: null, files: [] }` (an empty, harmless default,
	 * mirroring `showCommit`'s own default). A sha absent from `stashForTest`
	 * entirely rejects with `GIT_STASH_NOT_FOUND`, matching the real
	 * not-a-stash-like-commit rejection. */
	readonly stashShowForTest?: Readonly<Record<string, GitStashShowResult>>;
	/** `F090` S4: seeds a forced `{ kind: "conflict", conflictedPaths }`
	 * outcome for `gitStashApply`/`gitStashPop`, keyed by stash sha — a sha
	 * with no entry here always applies/pops cleanly. A conflicting *pop*
	 * correctly leaves the entry in `stashForTest`'s own mutable list
	 * untouched (mirrors the real `git stash pop`'s "kept on conflict"
	 * semantics this feature's own acceptance criteria require). */
	readonly stashConflictForTest?: Readonly<Record<string, readonly string[]>>;
	/** `F090` S5: seeds the initial, mutable `gitWorktreeList` state (defaults
	 * to a single synthetic main-worktree entry, since a real repository
	 * always has at least one) — `gitWorktreeAdd`/`gitWorktreeRemove` mutate
	 * this in place, mirroring `stashForTest`'s own "mutable simulation, not a
	 * re-implementation of real git plumbing" scope; the real Rust parser's
	 * thorough fixture coverage (main/linked/detached/locked/prunable/
	 * non-ASCII entries) lives in `src-tauri/src/git/worktree/tests.rs`. A
	 * seeded entry's own `lockReason`/`isMain` are consulted by the mock
	 * `gitWorktreeRemove` below (see that fixture's own doc comment) rather
	 * than duplicating them into a second, parallel fixture shape. */
	readonly worktreesForTest?: readonly GitWorktreeEntry[];
	/** `F090` S5: when `true`, every `gitWorktreeAdd` call returns
	 * `{ kind: "pickerCancelled" }` without mutating `worktreesForTest`'s own
	 * list — simulates the native folder-picker dialog being dismissed
	 * without a selection. A disclosed simplification (not a one-shot queue
	 * like `BrowserMockWorkspacePick`'s own scripted outcomes): a consuming
	 * test that needs "cancelled once, then succeeds" configures two separate
	 * mock instances instead. */
	readonly worktreeAddCancelledForTest?: boolean;
	/** `F090` S5: the set of worktree paths (matched against
	 * `worktreesForTest`'s own `path` field) `gitWorktreeRemove` reports
	 * `"needsForce"` for when called with `force: false` — mirrors
	 * `stashConflictForTest`'s own "seed a specific, scriptable non-default
	 * outcome by identity" shape. Calling again with `force: true` for the
	 * same path always succeeds and removes the entry (a locked or main
	 * entry rejects regardless — see the mock `gitWorktreeRemove`'s own doc
	 * comment). */
	readonly worktreeDirtyForTest?: readonly string[];
	/** When `true`, every git method rejects with `GIT_NO_REPOSITORY` instead
	 * of returning fixture data — simulates a trusted workspace root that is
	 * not (or no longer) a Git working tree. */
	readonly noRepositoryForTest?: boolean;
	/** `F080` S4: seeds the deterministic `gitNetworkPreview`/`gitFetch`/
	 * `gitPull`/`gitPush` simulation — see
	 * `BrowserMockGitNetworkFixtureForTest`. */
	readonly networkForTest?: BrowserMockGitNetworkFixtureForTest;
}

/**
 * Deterministic, injectable `git_network_preview`/`git_fetch`/`git_pull`/
 * `git_push` simulation (`F080` S4) — like `BrowserMockGitFixtureForTest`'s
 * own doc comment says of the S1/S3 git fixtures, this mock never
 * re-implements real ahead/behind or non-fast-forward semantics (the real
 * Rust parsers/porcelain behavior already have thorough fixture coverage in
 * `src-tauri/src/git/network/tests.rs`); it only exists so a consuming
 * frontend (`PlainScmView`) has structurally correct, scriptable responses to
 * develop and test the confirm-then-call UI flow against.
 */
export interface BrowserMockGitNetworkFixtureForTest {
	/** Defaults to `"origin/main"`. `null` simulates no upstream configured —
	 * matches the real `GIT_NETWORK_NO_UPSTREAM` preview rejection for
	 * `"pull"`/`"push"`, and the real `{ upstream: null, ahead: null, behind:
	 * null }` outcome for `"fetch"`. */
	readonly upstream?: string | null;
	/** Defaults to `0`. Mutated in place: a mock `gitPush` resets this to `0`
	 * on success, mirroring `ahead` clearing once local commits are actually
	 * uploaded. */
	readonly ahead?: number;
	/** Defaults to `0`. Mutated in place: a mock `gitPull` resets this to `0`
	 * on success (simulating the remote's commits being merged in); a mock
	 * `gitPush` rejects with `GIT_PUSH_REJECTED` while this is still nonzero
	 * and `force` is `false` — the same non-fast-forward shape a real stale
	 * remote-tracking ref produces. */
	readonly behind?: number;
	/** When `true`, a mock `gitPush(true)` (force) rejects with
	 * `GIT_PUSH_REJECTED` regardless of `behind` — simulates a stale
	 * `--force-with-lease` lease, letting Browser E2E exercise the
	 * force-push-rejected path without modeling a real divergent remote. */
	readonly forcePushRejectedForTest?: boolean;
}

/**
 * Deterministic, injectable `debug_stack_trace`/`debug_scopes`/
 * `debug_variables`/`debug_evaluate`/`debug_set_breakpoints` responses
 * (`F100` S3) — like `BrowserMockGitFixtureForTest`'s own doc comment says of
 * the git fixtures, this mock never re-implements a real DAP adapter (the
 * real protocol-level behavior — handshake ordering, `request_seq`
 * correlation, capability negotiation — has thorough fixture coverage in
 * `src-tauri/src/debug/{session,service}/tests.rs`, including a real spawned
 * Python mock adapter); it only exists so a consuming frontend (the call
 * stack/variables/watch views) has structurally correct, scriptable
 * responses to develop and test against. Every one of the by-id/by-reference
 * maps below mirrors this mock's other fixtures' own "a missing key defaults
 * to an empty, harmless result" convention rather than rejecting.
 */
export interface BrowserMockDebugFixtureForTest {
	/** The negotiated `Capabilities` every mock `debugLaunch`/`debugAttach`
	 * call returns — defaults to `{}` (every `supportsXxx` query answers
	 * `false`), letting a test exercise the capability-gated
	 * conditional-breakpoint/log-point UI's disabled path without seeding
	 * anything, and its enabled path by setting e.g.
	 * `{ supportsConditionalBreakpoints: true }`. */
	readonly capabilities?: Readonly<Record<string, unknown>>;
	/** Keyed by `threadId` — the full (unpaged) synthetic call stack
	 * `debugStackTrace` slices by `startFrame`/`levels` exactly like a real
	 * adapter would (this mock does implement real slicing, not a canned
	 * per-call response, so a test can genuinely exercise pagination). A
	 * missing `threadId` key defaults to an empty stack. */
	readonly stackFramesByThread?: Readonly<
		Record<number, readonly DebugStackFrame[]>
	>;
	/** Keyed by `frameId` — a missing key defaults to an empty `scopes` array
	 * (the "genuinely empty scopes" scenario this feature's own acceptance
	 * criteria call out), not an error. */
	readonly scopesByFrame?: Readonly<Record<number, readonly DebugScope[]>>;
	/** Keyed by `variablesReference` — the full (unpaged) synthetic children
	 * list `debugVariables` slices by `start`/`count` exactly like a real
	 * adapter would, letting a test seed a large synthetic collection (e.g.
	 * a 5,000-element array) and exercise real pagination rather than a
	 * canned per-call response. A missing reference defaults to an empty
	 * list. */
	readonly variablesByReference?: Readonly<
		Record<number, readonly DebugVariable[]>
	>;
	/** Keyed by the literal `expression` string — a missing key falls back to
	 * a harmless synthetic result (`{ result: expression, ... }`) rather than
	 * rejecting, so a test only needs to seed the expressions it actually
	 * cares about asserting on. */
	readonly evaluateByExpression?: Readonly<Record<string, DebugEvaluateResult>>;
	/** Keyed by `path`, then by the *requested* line number — lets a test
	 * script the two adversarial `setBreakpoints` outcomes this feature's own
	 * acceptance criteria name explicitly: an adapter moving a breakpoint to
	 * a different line (`{ line: <different number> }`) and an adapter
	 * rejecting one outright (`{ verified: false, message: "…" }`). A
	 * requested line with no scripted outcome verifies as-is, at the
	 * requested line. */
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
	/** `F210` S4 — keyed by `frameId`; a missing key defaults to an empty
	 * `targets` array (the "genuinely no step-in targets" scenario, e.g. a
	 * line with no call), not an error. This mock never simulates the
	 * `MAX_DEBUG_STEP_IN_TARGETS` truncation Rust enforces (a test seeding
	 * more than 256 synthetic targets here would just get all of them back,
	 * with `truncated: false`) — that real, considered boundary behavior is
	 * covered end to end against `debug::dto::parse_step_in_targets_response`
	 * directly in `src-tauri/src/debug/dto.rs`'s own tests, matching this
	 * mock's stated scope of structurally correct, scriptable responses
	 * rather than a faithful re-simulation of every server-side limit. */
	readonly stepInTargetsByFrame?: Readonly<
		Record<number, readonly DebugStepInTarget[]>
	>;
	/** `F210` S5 — keyed by `memoryReference`, then by the *requested*
	 * `instructionOffset` — lets a test script a full disassembly window per
	 * page (the initial load's `0` offset, an Up page's negative offset, a
	 * Down page's positive offset) exactly like a real adapter's own bounded
	 * `disassemble` response. A missing `memoryReference` or
	 * `instructionOffset` key defaults to an empty `instructions` array, not
	 * an error — mirrors this mock's other "genuinely empty result" fixtures
	 * (`scopesByFrame`, `stepInTargetsByFrame`). This mock never simulates the
	 * real `MAX_DEBUG_DISASSEMBLE_INSTRUCTION_COUNT` request-side rejection or
	 * the "adapter reported more than requested" fail-closed response
	 * rejection — both are covered end to end against
	 * `debug::dto::parse_disassemble_response` directly in
	 * `src-tauri/src/debug/dto.rs`'s own tests, matching this mock's stated
	 * scope of structurally correct, scriptable responses rather than a
	 * faithful re-simulation of every server-side limit. */
	readonly disassemblyByMemoryReference?: Readonly<
		Record<
			string,
			Readonly<Record<number, readonly DebugDisassembledInstruction[]>>
		>
	>;
	/** `F210` S6 — scripts the spawn-then-connect (`transport: "tcpSpawn"`)
	 * outcome every mock `debugLaunch`/`debugAttach` call reaches once past
	 * the trust/confirmation gates `startMockDebugSession` already enforces
	 * — defaults to `"success"` (the session starts normally, exactly like
	 * every other transport). The two failure outcomes mirror the real Rust
	 * orchestration's own distinct error codes
	 * (`src-tauri/src/debug/mod.rs`'s
	 * `debug_adapter_tcp_companion_exited`/
	 * `debug_adapter_tcp_companion_connect_timed_out`) — this mock reports
	 * the identical `code`/message shape (not a re-simulation of the real
	 * spawn/retry-connect timing, which has zero real process or socket to
	 * simulate against in a browser) so a consuming frontend's own
	 * error-surfacing path can be exercised deterministically; that real
	 * timing is covered end to end against real fixtures in
	 * `src-tauri/src/debug/{tcp,service}/tests.rs`. Only consulted for a
	 * `"tcpSpawn"`-transport request — every `"stdio"`/`"tcp"` launch ignores
	 * this field entirely. */
	readonly tcpSpawnOutcomeForTest?:
		"success" | "processExitedBeforeListening" | "connectTimedOut";
}

/**
 * Per-session control surface for the mock debug session `debugLaunch`/
 * `debugAttach` creates — handed to `onDebugSessionForTest` the instant a
 * session starts, mirroring `BrowserMockTerminalSessionController`'s own
 * "per-session push surface" shape. It only pushes whatever DAP event a test
 * scripts, exactly as a real adapter would over `plain://debug-event`, which
 * is precisely what the call-stack view's own "`stopped` drives a refresh"
 * wiring needs to exercise. `F100` S4's own `debugContinue`/`debugNext`/
 * `debugStepIn`/`debugStepOut`/`debugPause` command surface is implemented
 * elsewhere in this mock (always succeeding for any live session) — see
 * those methods' own doc comment for why this mock does not additionally
 * simulate the adversarial "not stopped" adapter rejection real Rust
 * integration tests already cover.
 */
export interface BrowserMockDebugSessionController {
	readonly sessionId: string;
	/** Pushes one DAP event (or one of Plain's own `plain/`-prefixed synthetic
	 * notifications) to every current `debugWatchEvent` listener, exactly as
	 * `src-tauri/src/debug/session.rs`'s `DebugEventSink::emit_event` would. */
	emitEvent(event: string, body: unknown): void;
	/** Simulates the transport closing: removes the session from this mock's
	 * live-session table (so a further call against `sessionId` now rejects
	 * with `DEBUG_SESSION_NOT_FOUND`, exactly like the real backend after
	 * `close_window`/a crashed adapter) and pushes the reserved
	 * `"plain/sessionEnded"` event, mirroring
	 * `DebugEventSink::emit_session_ended`. Idempotent after the first call. */
	finish(): void;
}

/**
 * Per-session control surface for the deterministic fake PTY `terminalStart`
 * creates in the browser mock — handed to `onTerminalSessionForTest` the
 * instant a session starts. Each session (indeed each bridge instance) has
 * fully independent state; nothing here is shared across sessions or across
 * separate `createBrowserMockBridge` calls.
 *
 * This mock's fake PTY is deliberately minimal — a single-row "echo" grid,
 * not a real VT emulator (no newline/scrollback/cursor-movement handling) —
 * per F070's "IPC 改造" slice's own scope: it exists to give a real
 * consuming renderer (a later slice) structurally correct `TerminalFrame`s
 * to develop and test against, not to reproduce `libghostty-vt`'s actual
 * terminal semantics. It does, however, faithfully mirror the *protocol*:
 * the same single-frame-in-flight emission credit gate real sessions use
 * (see `src-tauri/src/terminal/service.rs`'s module doc) governs when a
 * pushed/echoed change actually gets delivered to `terminalWatchData`
 * listeners.
 */
export interface BrowserMockTerminalSessionController {
	readonly sessionId: string;
	/**
	 * Appends `text` to the session's single echo row and attempts an
	 * emission, subject to the same single-frame-in-flight credit gate a
	 * real session's vt thread enforces: if a previously emitted frame is
	 * still unacknowledged, this queues the change (coalesced into
	 * whatever the *next* eligible frame reports) rather than emitting
	 * immediately — this is how a caller drives (and observes) real
	 * frame-delivery backpressure deterministically.
	 */
	pushOutput(text: string): void;
	/**
	 * Reports the session as exited with `exitCode` (idempotent after the
	 * first call — later calls are ignored). Does not force-flush any
	 * not-yet-emitted (credit-gated) pending content: this mirrors the real
	 * exit-vs-last-frame race `src-tauri/src/terminal/service.rs`'s module
	 * doc documents rather than "fixing" it away, so this mock stays a
	 * faithful stand-in for that behavior in E2E tests. `F190` S6: `signal`
	 * (default `null`, a normal exit) mirrors `TerminalExitEvent.signal` —
	 * pass a non-`null` value to simulate a signal-terminated process, in
	 * which case `exitCode` alone is not meaningful (see that field's own
	 * doc comment).
	 */
	finish(exitCode: number, signal?: string | null): void;
	/** Whether a previously emitted frame is currently unacknowledged (the
	 * mock analogue of the real single-frame-in-flight emission credit
	 * gate being exhausted). */
	isAwaitingAckForTest(): boolean;
	/** The sequence number of the most recently emitted frame, or `null` if
	 * none has been emitted yet. */
	lastEmittedSequenceForTest(): number | null;
}

interface CapturedBrowserMockWorkspaceMoveSeams {
	readonly afterPublication: BrowserMockBridgeOptions["onWorkspaceMoveAfterPublicationForTest"];
	readonly beforeDelete: BrowserMockBridgeOptions["onWorkspaceMoveBeforeDeleteForTest"];
	readonly afterDeleteEntry: BrowserMockBridgeOptions["onWorkspaceMoveAfterDeleteEntryForTest"];
	readonly deleteEntry: BrowserMockBridgeOptions["onWorkspaceMoveDeleteForTest"];
	readonly receiptVisit: BrowserMockBridgeOptions["onWorkspaceMoveReceiptVisitForTest"];
}

interface CapturedBrowserMockWorkspaceDeleteSeams {
	readonly clock: () => number;
	readonly prepared: BrowserMockBridgeOptions["onWorkspaceDeletePreparedForTest"];
	readonly begin: BrowserMockBridgeOptions["onWorkspaceDeleteBeginForTest"];
	readonly beforeRemove: BrowserMockBridgeOptions["onWorkspaceDeleteBeforeRemoveForTest"];
	readonly afterRemove: BrowserMockBridgeOptions["onWorkspaceDeleteAfterRemoveForTest"];
	readonly remove: BrowserMockBridgeOptions["onWorkspaceDeleteRemoveForTest"];
	readonly receiptVisit: BrowserMockBridgeOptions["onWorkspaceDeleteReceiptVisitForTest"];
}

interface CapturedBrowserMockWorkspaceWriteSeams {
	readonly beforePublication: BrowserMockBridgeOptions["onWorkspaceWriteBeforePublicationForTest"];
	readonly rename: BrowserMockBridgeOptions["onWorkspaceWriteRenameForTest"];
	readonly directorySync: BrowserMockBridgeOptions["onWorkspaceWriteDirectorySyncForTest"];
	readonly afterPublication: BrowserMockBridgeOptions["onWorkspaceWriteAfterPublicationForTest"];
}

function captureBrowserMockWorkspaceWatchController(
	options: BrowserMockBridgeOptions,
): BrowserMockBridgeOptions["onWorkspaceWatchControllerForTest"] {
	const capture = options.onWorkspaceWatchControllerForTest;
	if (capture !== undefined && typeof capture !== "function") {
		throw new TypeError("Invalid browser mock workspace-watch seam.");
	}
	return capture;
}

function captureBrowserMockWorkspaceMoveSeams(
	options: BrowserMockBridgeOptions,
): CapturedBrowserMockWorkspaceMoveSeams {
	const afterPublication = options.onWorkspaceMoveAfterPublicationForTest;
	const beforeDelete = options.onWorkspaceMoveBeforeDeleteForTest;
	const afterDeleteEntry = options.onWorkspaceMoveAfterDeleteEntryForTest;
	const deleteEntry = options.onWorkspaceMoveDeleteForTest;
	const receiptVisit = options.onWorkspaceMoveReceiptVisitForTest;
	for (const seam of [
		afterPublication,
		beforeDelete,
		afterDeleteEntry,
		deleteEntry,
		receiptVisit,
	]) {
		if (seam !== undefined && typeof seam !== "function") {
			throw new TypeError("Invalid browser mock workspace-move seam.");
		}
	}
	return Object.freeze({
		afterPublication,
		beforeDelete,
		afterDeleteEntry,
		deleteEntry,
		receiptVisit,
	});
}

function captureBrowserMockWorkspaceDeleteSeams(
	options: BrowserMockBridgeOptions,
): CapturedBrowserMockWorkspaceDeleteSeams {
	const clock =
		options.workspaceDeleteClockForTest ??
		(() => Math.floor(globalThis.performance.now()));
	const prepared = options.onWorkspaceDeletePreparedForTest;
	const begin = options.onWorkspaceDeleteBeginForTest;
	const beforeRemove = options.onWorkspaceDeleteBeforeRemoveForTest;
	const afterRemove = options.onWorkspaceDeleteAfterRemoveForTest;
	const remove = options.onWorkspaceDeleteRemoveForTest;
	const receiptVisit = options.onWorkspaceDeleteReceiptVisitForTest;
	for (const seam of [
		clock,
		prepared,
		begin,
		beforeRemove,
		afterRemove,
		remove,
		receiptVisit,
	]) {
		if (seam !== undefined && typeof seam !== "function") {
			throw new TypeError("Invalid browser mock workspace-delete seam.");
		}
	}
	return Object.freeze({
		clock,
		prepared,
		begin,
		beforeRemove,
		afterRemove,
		remove,
		receiptVisit,
	});
}

function captureBrowserMockWorkspaceWriteSeams(
	options: BrowserMockBridgeOptions,
): CapturedBrowserMockWorkspaceWriteSeams {
	const beforePublication = options.onWorkspaceWriteBeforePublicationForTest;
	const rename = options.onWorkspaceWriteRenameForTest;
	const directorySync = options.onWorkspaceWriteDirectorySyncForTest;
	const afterPublication = options.onWorkspaceWriteAfterPublicationForTest;
	for (const seam of [
		beforePublication,
		rename,
		directorySync,
		afterPublication,
	]) {
		if (seam !== undefined && typeof seam !== "function") {
			throw new TypeError("Invalid browser mock workspace-write seam.");
		}
	}
	return Object.freeze({
		beforePublication,
		rename,
		directorySync,
		afterPublication,
	});
}

function commandError(code: string, message: string): CommandError {
	return Object.freeze({ code, message });
}

/** `F220` S1 — the mock's own `(host, port)` key for its known-hosts pin
 * store and per-target scripted-outcome lookups. */
function remoteMockTargetKey(host: string, port: number): string {
	return `${host}:${port}`;
}

/** Deterministic FNV-1a digest — used only to fabricate a stable, distinct,
 * fingerprint-shaped string per `(host, port)` (and per `changed` epoch, for
 * `changedHostKeyTargetsForTest`) without needing any real cryptographic
 * hashing or randomness: this mock never holds a real key, only a
 * fingerprint-*shaped* value the codec's own `SHA256:<base64-charset>`
 * decode-side check accepts. */
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

function rootNotAuthorized(): CommandError {
	return commandError(
		"ROOT_NOT_AUTHORIZED",
		"The workspace root is not authorized.",
	);
}

function invalidRelativePath(): CommandError {
	return commandError(
		"INVALID_RELATIVE_PATH",
		"The workspace-relative path is invalid.",
	);
}

function entryNotFound(): CommandError {
	return commandError("ENTRY_NOT_FOUND", "The workspace entry does not exist.");
}

function entryAlreadyExists(): CommandError {
	return commandError(
		"ENTRY_ALREADY_EXISTS",
		"The workspace entry already exists.",
	);
}

function entryTypeMismatch(): CommandError {
	return commandError(
		"ENTRY_TYPE_MISMATCH",
		"The workspace entry has an incompatible type.",
	);
}

function copyConflict(): CommandError {
	return commandError(
		"WORKSPACE_CONFLICT",
		"The workspace copy conflicts with the source path.",
	);
}

function fileTooLarge(): CommandError {
	return commandError(
		"FILE_TOO_LARGE",
		"The workspace file exceeds the supported read limit.",
	);
}

function invalidSearchRegex(): CommandError {
	return commandError(
		"INVALID_SEARCH_REGEX",
		"The workspace text search pattern is not a valid regular expression.",
	);
}

function searchNotFound(): CommandError {
	return commandError(
		"WORKSPACE_SEARCH_NOT_FOUND",
		"The workspace text search is no longer available.",
	);
}

function themeResourceNotFound(): CommandError {
	return commandError(
		"THEME_RESOURCE_NOT_FOUND",
		"The requested theme package resource is not available.",
	);
}

function invalidSearchRequest(): CommandError {
	return commandError(
		"INVALID_SEARCH_REQUEST",
		"The workspace text search request is invalid.",
	);
}

function workspaceWriteUnsupported(): CommandError {
	return commandError(
		"WORKSPACE_WRITE_UNSUPPORTED",
		"The workspace file does not support versioned writes.",
	);
}

function workspaceFileChanged(): CommandError {
	return commandError(
		"WORKSPACE_FILE_MODIFIED",
		"The workspace file changed before it could be written.",
	);
}

function workspaceWindowClosed(): CommandError {
	return commandError(
		"WORKSPACE_WINDOW_CLOSED",
		"The workspace window is closed.",
	);
}

function workspaceWriteFailed(): CommandError {
	return commandError("IO_FAILED", "The workspace file could not be written.");
}

function workspaceWriteConflict(): CommandError {
	return commandError(
		"WORKSPACE_CONFLICT",
		"The workspace write staging state changed before publication.",
	);
}

function copyFileTooLarge(): CommandError {
	return commandError(
		"FILE_TOO_LARGE",
		"The workspace file exceeds the supported copy limit.",
	);
}

function symlinkTooLarge(): CommandError {
	return commandError(
		"FILE_TOO_LARGE",
		"The workspace symbolic link exceeds the supported copy limit.",
	);
}

function directoryCopyTooLarge(): CommandError {
	return commandError(
		"DIRECTORY_TOO_LARGE",
		"The workspace directory exceeds the supported copy limits.",
	);
}

function pathEncodingUnsupported(): CommandError {
	return commandError(
		"PATH_ENCODING_UNSUPPORTED",
		"The workspace entry name cannot be represented safely.",
	);
}

function workspaceDeletePlanInvalid(): CommandError {
	return commandError(
		"WORKSPACE_DELETE_PLAN_INVALID",
		"The workspace delete plan is invalid.",
	);
}

function workspaceDeleteConflict(): CommandError {
	return commandError(
		"WORKSPACE_CONFLICT",
		"The workspace delete selection conflicts with another entry.",
	);
}

function workspaceDeleteBatchChanged(): CommandError {
	return commandError(
		"WORKSPACE_DELETE_BATCH_CHANGED",
		"The workspace delete selection changed before deletion began.",
	);
}

function workspaceDeleteBatchUnverifiable(): CommandError {
	return commandError(
		"WORKSPACE_DELETE_BATCH_UNVERIFIABLE",
		"The workspace delete selection could not be verified.",
	);
}

function workspaceTrashPlanInvalid(): CommandError {
	return commandError(
		"WORKSPACE_TRASH_PLAN_INVALID",
		"The workspace Trash plan is invalid.",
	);
}

function workspaceTrashConflict(): CommandError {
	return commandError(
		"WORKSPACE_CONFLICT",
		"The workspace Trash selection conflicts with another entry.",
	);
}

function workspaceTrashBatchChanged(): CommandError {
	return commandError(
		"WORKSPACE_TRASH_BATCH_CHANGED",
		"The workspace Trash selection changed before the operation began.",
	);
}

function directoryNotEmpty(): CommandError {
	return commandError(
		"DIRECTORY_NOT_EMPTY",
		"The workspace directory is not empty.",
	);
}

function resolveWorkspaceDeleteLimits(
	overrides: BrowserMockWorkspaceDeleteLimitsForTest | undefined,
): WorkspaceDeleteLimits {
	if (overrides === undefined) {
		return WORKSPACE_DELETE_LIMITS;
	}
	const resolved = { ...WORKSPACE_DELETE_LIMITS };
	const keys = Object.keys(
		WORKSPACE_DELETE_LIMITS,
	) as (keyof WorkspaceDeleteLimits)[];
	const allowed = new Set<string>(keys);
	if (
		Reflect.ownKeys(overrides).some(
			(key) => typeof key !== "string" || !allowed.has(key),
		)
	) {
		throw new Error("Invalid browser mock workspace-delete limits.");
	}
	for (const key of keys) {
		const value = overrides[key];
		if (value === undefined) {
			continue;
		}
		if (
			!Number.isSafeInteger(value) ||
			value < 0 ||
			value > WORKSPACE_DELETE_LIMITS[key]
		) {
			throw new Error("Invalid browser mock workspace-delete limits.");
		}
		resolved[key] = value;
	}
	return Object.freeze(resolved);
}

function resolveDirectoryCopyLimits(
	overrides: BrowserMockDirectoryCopyLimitsForTest | undefined,
): DirectoryCopyLimits {
	if (overrides === undefined) {
		return DIRECTORY_COPY_LIMITS;
	}

	const resolved = { ...DIRECTORY_COPY_LIMITS };
	const keys = Object.keys(
		DIRECTORY_COPY_LIMITS,
	) as (keyof DirectoryCopyLimits)[];
	const allowed = new Set<string>(keys);
	if (
		Reflect.ownKeys(overrides).some(
			(key) => typeof key !== "string" || !allowed.has(key),
		)
	) {
		throw new Error("Invalid browser mock directory-copy limits.");
	}
	for (const key of keys) {
		const value = overrides[key];
		if (value === undefined) {
			continue;
		}
		if (
			!Number.isSafeInteger(value) ||
			value < 0 ||
			value > DIRECTORY_COPY_LIMITS[key]
		) {
			throw new Error("Invalid browser mock directory-copy limits.");
		}
		resolved[key] = value;
	}
	return Object.freeze(resolved);
}

function fixtureNodeForTest(
	entry: BrowserMockDirectoryFixtureEntryForTest,
): MockNode {
	if (entry.kind === "hardlink") {
		throw new Error("Invalid browser mock directory-copy fixture.");
	}
	if (entry.kind === "directory") {
		return mockDirectory({});
	}
	if (entry.kind === "other") {
		return mockUnsupportedNode();
	}
	if (entry.kind === "symlink") {
		return mockSymlink(entry.payload);
	}

	if (
		!Number.isSafeInteger(entry.bytes.length) ||
		entry.bytes.length < 0 ||
		entry.bytes.length > MAX_FILE_BYTES
	) {
		throw new Error("Invalid browser mock directory-copy fixture.");
	}
	const bytes = Uint8Array.from(entry.bytes);
	return Object.freeze({ kind: "file", size: bytes.byteLength, bytes });
}

function installDirectoryCopyFixtureForTest(
	trees: Map<string, MockDirectoryNode>,
	fixture: BrowserMockDirectoryFixtureForTest | undefined,
): void {
	if (fixture === undefined) {
		return;
	}
	const root = trees.get(mockRoots[0]!.rootId);
	if (
		root === undefined ||
		!isPortableWorkspaceEntryName(fixture.name) ||
		root.entries.has(fixture.name)
	) {
		throw new Error("Invalid browser mock directory-copy fixture.");
	}

	const fixtureRoot = mockDirectory({});
	const entries = fixture.entries
		.map((entry, index) => {
			if (
				!Array.isArray(entry.path) ||
				entry.path.length === 0 ||
				entry.path.some((segment) => typeof segment !== "string")
			) {
				throw new Error("Invalid browser mock directory-copy fixture.");
			}
			return Object.freeze({ entry, index, path: [...entry.path] });
		})
		.sort(
			(left, right) =>
				left.path.length - right.path.length || left.index - right.index,
		);

	for (const { entry, path } of entries) {
		if (entry.kind === "hardlink") {
			continue;
		}
		let parent = fixtureRoot;
		for (const segment of path.slice(0, -1)) {
			const child = parent.entries.get(segment);
			if (child?.kind !== "directory") {
				throw new Error("Invalid browser mock directory-copy fixture.");
			}
			parent = child;
		}
		const name = path.at(-1)!;
		if (parent.entries.has(name)) {
			throw new Error("Invalid browser mock directory-copy fixture.");
		}
		parent.entries.set(name, fixtureNodeForTest(entry));
	}
	for (const { entry, path } of entries) {
		if (entry.kind !== "hardlink") {
			continue;
		}
		if (
			!Array.isArray(entry.targetPath) ||
			entry.targetPath.length === 0 ||
			entry.targetPath.some((segment) => typeof segment !== "string")
		) {
			throw new Error("Invalid browser mock directory-copy fixture.");
		}
		let target: MockNode = fixtureRoot;
		for (const segment of entry.targetPath) {
			if (target.kind !== "directory") {
				throw new Error("Invalid browser mock directory-copy fixture.");
			}
			const child = target.entries.get(segment);
			if (child === undefined) {
				throw new Error("Invalid browser mock directory-copy fixture.");
			}
			target = child;
		}
		if (target.kind !== "file") {
			throw new Error("Invalid browser mock directory-copy fixture.");
		}
		let parent = fixtureRoot;
		for (const segment of path.slice(0, -1)) {
			const child = parent.entries.get(segment);
			if (child?.kind !== "directory") {
				throw new Error("Invalid browser mock directory-copy fixture.");
			}
			parent = child;
		}
		const name = path.at(-1)!;
		if (parent.entries.has(name)) {
			throw new Error("Invalid browser mock directory-copy fixture.");
		}
		parent.entries.set(name, target);
	}
	root.entries.set(fixture.name, fixtureRoot);
}

function checkedDirectoryCopyTotal(
	current: number,
	increment: number,
	limit: number,
): number {
	if (
		!Number.isSafeInteger(current) ||
		!Number.isSafeInteger(increment) ||
		current < 0 ||
		increment < 0
	) {
		throw directoryCopyTooLarge();
	}
	const next = current + increment;
	if (!Number.isSafeInteger(next) || next > limit) {
		throw directoryCopyTooLarge();
	}
	return next;
}

function directoryCopyNameBytes(name: string, limit: number): number {
	const bytes = textEncoder.encode(name).byteLength;
	if (bytes > limit) {
		throw directoryCopyTooLarge();
	}
	if (!isPortableWorkspaceEntryName(name)) {
		throw pathEncodingUnsupported();
	}
	return bytes;
}

function assertDirectoryCopyWirePath(
	topSegments: readonly string[],
	descendantSegments: readonly string[],
	limits: DirectoryCopyLimits,
): void {
	const segments = [...topSegments, ...descendantSegments];
	if (segments.length > limits.pathSegments) {
		throw pathEncodingUnsupported();
	}
	const path = segments.join("/");
	if (
		textEncoder.encode(path).byteLength > limits.pathBytes ||
		workspaceRelativePathSegments(path) === undefined
	) {
		throw pathEncodingUnsupported();
	}
}

interface DirectoryCloneFrame {
	readonly source: MockDirectoryNode;
	readonly targetParent: MockDirectoryNode;
	readonly parentSegments: readonly string[];
	readonly depth: number;
	readonly entries: IterableIterator<[string, MockNode]>;
}

function boundedDirectoryClone(
	source: MockDirectoryNode,
	sourceSegments: readonly string[],
	targetSegments: readonly string[],
	limits: DirectoryCopyLimits,
): Readonly<{
	node: MockDirectoryNode;
	manifest: BrowserMockDirectoryCopyManifestSummary;
}> {
	directoryCopyNameBytes(sourceSegments.at(-1)!, limits.entryNameBytes);
	directoryCopyNameBytes(targetSegments.at(-1)!, limits.entryNameBytes);

	const clone = mockDirectory({});
	const manifestEntries: BrowserMockDirectoryCopyManifestEntrySummary[] = [];
	let descendants = 0;
	let maximumDepth = 0;
	let namePayloadBytes = 0;
	let logicalFileBytes = 0;
	let actualFileBytes = 0;
	let symlinkPayloadBytes = 0;
	const boundedSortedEntries = (
		directory: MockDirectoryNode,
		remainingDescendants: number,
	): IterableIterator<[string, MockNode]> => {
		const entries: [string, MockNode][] = [];
		for (const entry of directory.entries) {
			if (entries.length >= remainingDescendants) {
				throw directoryCopyTooLarge();
			}
			entries.push(entry);
		}
		entries.sort(([left], [right]) => compareWorkspaceEntryNames(left, right));
		return entries[Symbol.iterator]();
	};
	const frames: DirectoryCloneFrame[] = [
		Object.freeze({
			source,
			targetParent: clone,
			parentSegments: Object.freeze([]),
			depth: 0,
			entries: boundedSortedEntries(source, limits.descendants),
		}),
	];

	while (frames.length > 0) {
		const frame = frames.at(-1)!;
		const next = frame.entries.next();
		if (next.done) {
			frames.pop();
			continue;
		}
		const [name, sourceNode] = next.value;
		const depth = frame.depth + 1;
		if (!Number.isSafeInteger(depth) || depth > limits.depth) {
			throw directoryCopyTooLarge();
		}
		const relativeSegments = Object.freeze([...frame.parentSegments, name]);
		const nameBytes = directoryCopyNameBytes(name, limits.entryNameBytes);
		descendants = checkedDirectoryCopyTotal(descendants, 1, limits.descendants);
		namePayloadBytes = checkedDirectoryCopyTotal(
			namePayloadBytes,
			nameBytes,
			limits.namePayloadBytes,
		);
		maximumDepth = Math.max(maximumDepth, depth);
		assertDirectoryCopyWirePath(sourceSegments, relativeSegments, limits);
		assertDirectoryCopyWirePath(targetSegments, relativeSegments, limits);

		const relativePath = relativeSegments.join("/");
		if (sourceNode.kind === "file") {
			if (!Number.isSafeInteger(sourceNode.size) || sourceNode.size < 0) {
				throw directoryCopyTooLarge();
			}
			if (sourceNode.size > limits.fileBytes) {
				throw copyFileTooLarge();
			}
			logicalFileBytes = checkedDirectoryCopyTotal(
				logicalFileBytes,
				sourceNode.size,
				limits.totalFileBytes,
			);
			actualFileBytes = checkedDirectoryCopyTotal(
				actualFileBytes,
				sourceNode.bytes.byteLength,
				limits.totalFileBytes,
			);
			const bytes = sourceNode.bytes.slice();
			frame.targetParent.entries.set(
				name,
				Object.freeze({ kind: "file", size: sourceNode.size, bytes }),
			);
			manifestEntries.push(
				Object.freeze({
					relativePath,
					kind: "file",
					depth,
					size: sourceNode.size,
				}),
			);
			continue;
		}

		if (isMockSymlinkNode(sourceNode)) {
			if (sourceNode.payload.byteLength > limits.symlinkBytes) {
				throw symlinkTooLarge();
			}
			symlinkPayloadBytes = checkedDirectoryCopyTotal(
				symlinkPayloadBytes,
				sourceNode.payload.byteLength,
				limits.totalSymlinkBytes,
			);
			const payload = sourceNode.payload.copy();
			frame.targetParent.entries.set(name, mockSymlink(payload));
			manifestEntries.push(
				Object.freeze({
					relativePath,
					kind: "symlink",
					depth,
					size: payload.byteLength,
					payload: Object.freeze([...payload]),
				}),
			);
			continue;
		}

		if (sourceNode.kind === "directory") {
			const childClone = mockDirectory({});
			frame.targetParent.entries.set(name, childClone);
			manifestEntries.push(
				Object.freeze({
					relativePath,
					kind: "directory",
					depth,
					size: 0,
				}),
			);
			frames.push(
				Object.freeze({
					source: sourceNode,
					targetParent: childClone,
					parentSegments: relativeSegments,
					depth,
					entries: boundedSortedEntries(
						sourceNode,
						limits.descendants - descendants,
					),
				}),
			);
			continue;
		}

		throw entryTypeMismatch();
	}

	return Object.freeze({
		node: clone,
		manifest: Object.freeze({
			descendants,
			maximumDepth,
			namePayloadBytes,
			logicalFileBytes,
			actualFileBytes,
			symlinkPayloadBytes,
			entries: Object.freeze(manifestEntries),
		}),
	});
}

interface MockMoveReceiptEntry {
	readonly name: string;
	readonly relativePath: string;
	readonly depth: number;
	readonly receipt: MockMoveReceipt;
}

interface MockMoveFileReceipt {
	readonly kind: "file";
	readonly identity: MockFileNode;
	readonly size: number;
	readonly bytes: MockImmutableBytes;
}

interface MockMoveSymlinkReceipt {
	readonly kind: "symlink";
	readonly identity: MockSymlinkNode;
	readonly payload: MockImmutableBytes;
}

interface MockMoveDirectoryReceipt {
	readonly kind: "directory";
	readonly identity: MockDirectoryNode;
	readonly entries: readonly MockMoveReceiptEntry[];
}

type MockMoveReceipt =
	MockMoveFileReceipt | MockMoveSymlinkReceipt | MockMoveDirectoryReceipt;

interface MockMoveDirectoryDeletionPlan {
	readonly targetReceipt: MockMoveDirectoryReceipt;
	readonly leaves: readonly MockMoveReceiptEntry[];
	readonly directories: readonly MockMoveReceiptEntry[];
	readonly targetReceipts: ReadonlyMap<string, MockMoveReceipt>;
}

function captureMockMoveReceipt(
	node: MockNode,
	parentPath = "",
	depth = 0,
): MockMoveReceipt {
	if (node.kind === "file") {
		return Object.freeze({
			kind: node.kind,
			identity: node,
			size: node.size,
			bytes: immutableMockBytes(node.bytes),
		});
	}
	if (isMockSymlinkNode(node)) {
		return Object.freeze({
			kind: node.kind,
			identity: node,
			payload: immutableMockBytes(node.payload.copy()),
		});
	}
	if (node.kind !== "directory") {
		throw entryTypeMismatch();
	}

	const entries = [...node.entries]
		.sort(([left], [right]) => compareWorkspaceEntryNames(left, right))
		.map(([name, child]) => {
			const relativePath =
				parentPath.length === 0 ? name : `${parentPath}/${name}`;
			return Object.freeze({
				name,
				relativePath,
				depth: depth + 1,
				receipt: captureMockMoveReceipt(child, relativePath, depth + 1),
			});
		});
	return Object.freeze({
		kind: node.kind,
		identity: node,
		entries: Object.freeze(entries),
	});
}

function mockBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) {
		return false;
	}
	for (let index = 0; index < left.byteLength; index += 1) {
		if (left[index] !== right[index]) {
			return false;
		}
	}
	return true;
}

function matchesMockMoveReceipt(
	node: MockNode,
	receipt: MockMoveReceipt,
	visit?: () => void,
): boolean {
	visit?.();
	if (node !== receipt.identity || node.kind !== receipt.kind) {
		return false;
	}
	if (receipt.kind === "file") {
		return (
			node.kind === "file" &&
			node.size === receipt.size &&
			mockBytesEqual(node.bytes, receipt.bytes.copy())
		);
	}
	if (receipt.kind === "symlink") {
		return (
			isMockSymlinkNode(node) &&
			mockBytesEqual(node.payload.copy(), receipt.payload.copy())
		);
	}
	if (
		node.kind !== "directory" ||
		node.entries.size !== receipt.entries.length
	) {
		return false;
	}
	return receipt.entries.every((entry) => {
		const child = node.entries.get(entry.name);
		return (
			child !== undefined && matchesMockMoveReceipt(child, entry.receipt, visit)
		);
	});
}

function flattenMockMoveReceipt(
	receipt: MockMoveDirectoryReceipt,
): readonly MockMoveReceiptEntry[] {
	const flattened: MockMoveReceiptEntry[] = [];
	const pending = [...receipt.entries].reverse();
	while (pending.length > 0) {
		const entry = pending.pop()!;
		flattened.push(entry);
		if (entry.receipt.kind === "directory") {
			for (const child of [...entry.receipt.entries].reverse()) {
				pending.push(child);
			}
		}
	}
	return Object.freeze(flattened);
}

function prepareMockMoveDirectoryDeletionPlan(
	sourceReceipt: MockMoveReceipt,
	targetReceipt: MockMoveReceipt,
): MockMoveDirectoryDeletionPlan | undefined {
	if (sourceReceipt.kind !== "directory") {
		return undefined;
	}
	if (targetReceipt.kind !== "directory") {
		throw entryTypeMismatch();
	}

	const flattened = flattenMockMoveReceipt(sourceReceipt);
	const leaves = flattened
		.filter((entry) => entry.receipt.kind !== "directory")
		.sort(
			(left, right) =>
				right.depth - left.depth ||
				compareWorkspaceEntryNames(left.relativePath, right.relativePath),
		);
	const directories = flattened
		.filter((entry) => entry.receipt.kind === "directory")
		.sort(
			(left, right) =>
				right.depth - left.depth ||
				compareWorkspaceEntryNames(left.relativePath, right.relativePath),
		);
	const targetReceipts = new Map(
		flattenMockMoveReceipt(targetReceipt).map((entry) => [
			entry.relativePath,
			entry.receipt,
		]),
	);
	return Object.freeze({
		targetReceipt,
		leaves: Object.freeze(leaves),
		directories: Object.freeze(directories),
		targetReceipts,
	});
}

type MockMoveObserverReason = Exclude<
	WorkspaceMoveIncompleteReason,
	"deleteFailed"
>;

const WORKSPACE_MOVE_OBSERVER_REASONS = new Set<MockMoveObserverReason>([
	"sourceChanged",
	"targetChanged",
	"sourceUnverifiable",
	"targetUnverifiable",
]);

function mockMoveResolutionFailure(
	error: unknown,
	changedReason: "sourceChanged" | "targetChanged",
	unverifiableReason: "sourceUnverifiable" | "targetUnverifiable",
): WorkspaceMoveIncompleteReason {
	try {
		const code = (error as { readonly code?: unknown })?.code;
		return code === "ENTRY_NOT_FOUND" || code === "ENTRY_TYPE_MISMATCH"
			? changedReason
			: unverifiableReason;
	} catch {
		return unverifiableReason;
	}
}

interface MockDeleteMetadata {
	mode: number;
	version: number;
	nlink: number;
}

interface MockDeleteMetadataSnapshot {
	readonly mode: number;
	readonly version: number;
	readonly nlink: number;
}

interface MockDeleteReceiptEntry {
	readonly name: string;
	readonly relativePath: string;
	readonly depth: number;
	readonly parentIdentity: MockDirectoryNode;
	readonly parentEntryCount: number;
	readonly receipt: MockDeleteReceipt;
}

interface MockDeleteFileReceipt {
	readonly kind: "file";
	readonly identity: MockFileNode;
	readonly size: number;
	readonly metadata: MockDeleteMetadataSnapshot;
}

interface MockDeleteSymlinkReceipt {
	readonly kind: "symlink";
	readonly identity: MockSymlinkNode;
	readonly payload: MockImmutableBytes;
	readonly metadata: MockDeleteMetadataSnapshot;
}

interface MockDeleteDirectoryReceipt {
	readonly kind: "directory";
	readonly identity: MockDirectoryNode;
	readonly metadata: MockDeleteMetadataSnapshot;
	readonly entries: readonly MockDeleteReceiptEntry[];
}

type MockDeleteReceipt =
	MockDeleteFileReceipt | MockDeleteSymlinkReceipt | MockDeleteDirectoryReceipt;

interface MockDeleteTopReceipt {
	readonly request: WorkspaceDeleteEntryRequest;
	readonly parentIdentity: MockDirectoryNode;
	readonly name: string;
	readonly receipt: MockDeleteReceipt;
	readonly receiptIdentities: ReadonlySet<MockNode>;
	readonly descendantEntries: number;
}

interface MockDeleteBatchEntry {
	readonly entryId: string;
	readonly top: MockDeleteTopReceipt;
}

interface MockDeleteBatch {
	readonly confirmationId: string;
	readonly revision: number;
	readonly entries: readonly MockDeleteBatchEntry[];
	phase: "prepared" | "executing";
	nextIndex: number;
	deadline: number;
	inFlight: boolean;
}

type MockTrashReceipt =
	| Readonly<{
			kind: "file";
			identity: MockFileNode;
			metadata: MockDeleteMetadataSnapshot;
			size: number;
	  }>
	| Readonly<{
			kind: "directory";
			identity: MockDirectoryNode;
			metadata: MockDeleteMetadataSnapshot;
	  }>
	| Readonly<{
			kind: "symlink";
			identity: MockSymlinkNode;
			metadata: MockDeleteMetadataSnapshot;
			payload: MockImmutableBytes;
	  }>;

interface MockTrashTopReceipt {
	readonly request: WorkspaceTrashEntryRequest;
	readonly parentIdentity: MockDirectoryNode;
	readonly name: string;
	readonly receipt: MockTrashReceipt;
}

interface MockTrashBatchEntry {
	readonly entryId: string;
	readonly top: MockTrashTopReceipt;
}

interface MockTrashBatch {
	readonly confirmationId: string;
	readonly revision: number;
	readonly entries: readonly MockTrashBatchEntry[];
	phase: "prepared" | "executing";
	nextIndex: number;
	deadline: number;
	inFlight: boolean;
}

interface MockDeleteJournal {
	readonly removedPaths: Set<string>;
	readonly expectedMetadata: Map<MockNode, MockDeleteMetadataSnapshot>;
	readonly removedChildCounts: Map<MockDirectoryNode, number>;
}

export function createBrowserMockBridge(
	options: BrowserMockBridgeOptions = {},
): PlainBridge {
	const workspaceMoveSeams = captureBrowserMockWorkspaceMoveSeams(options);
	const workspaceDeleteSeams = captureBrowserMockWorkspaceDeleteSeams(options);
	const workspaceWriteSeams = captureBrowserMockWorkspaceWriteSeams(options);
	const captureWorkspaceWatchController =
		captureBrowserMockWorkspaceWatchController(options);
	const listeners = new Set<(payload: RuntimeInfo) => void>();
	const nativeCloseListeners = new Set<(payload: NativeCloseRequest) => void>();
	const userDataChangedListeners = new Set<
		(payload: UserDataChangedEvent) => void
	>();
	const userDataEntries = new Map<
		UserDataResource,
		{ revision: number; content: string }
	>([
		["settings", { revision: 1, content: "{}\n" }],
		["keybindings", { revision: 1, content: "[]\n" }],
	]);
	const scriptedPicks = [...(options.workspacePicks ?? [])];
	const scriptedFilePicks = [...(options.workspaceFilePicks ?? [])];
	const scriptedSavePicks = [...(options.workspaceSavePicks ?? [])];
	const roots = new Map<string, WorkspaceRoot>();
	const backupEntries = new Map<
		string,
		Readonly<{ rootId: string; key: string; bytes: Uint8Array }>
	>();
	const scratchEntries = new Map<string, Uint8Array>();
	let nextScratchOrdinal = 1;
	const backupMapKey = (rootId: string, key: string): string =>
		`${rootId}\0${key}`;
	for (const seed of options.backupFixtureForTest ?? []) {
		const { rootId, key, content } = frozenBackupWriteInputs(
			seed.rootId,
			seed.key,
			Uint8Array.from(seed.bytes),
		);
		backupEntries.set(
			backupMapKey(rootId, key),
			Object.freeze({ rootId, key, bytes: content }),
		);
	}
	const themePackages = new Map<string, ThemePackageSummary>();
	const themeResourceContents = new Map<string, ReadonlyMap<string, string>>();
	function seedThemePackage(fixture: BrowserMockThemePackageFixture): void {
		themePackages.set(fixture.summary.id, fixture.summary);
		themeResourceContents.set(
			fixture.summary.id,
			new Map(Object.entries(fixture.resourceContents)),
		);
	}
	for (const fixture of options.themeLibraryFixtureForTest ?? []) {
		seedThemePackage(fixture);
	}
	let themeSelection: string | null = options.themeSelectionForTest ?? null;
	let fileIconThemeSelection: string | null =
		options.fileIconThemeSelectionForTest ?? null;
	let productIconThemeSelection: string | null =
		options.productIconThemeSelectionForTest ?? null;
	const scriptedThemeImports = [...(options.themeImportOutcomesForTest ?? [])];
	function themeImportFromScript(): ThemeImportResult {
		const outcome = scriptedThemeImports.shift();
		if (outcome === undefined || outcome.status === "cancelled") {
			return Object.freeze({ status: "cancelled" });
		}
		seedThemePackage(outcome.fixture);
		return Object.freeze({
			status: "imported",
			package: outcome.fixture.summary,
		});
	}
	const trees = cloneMockTrees();
	const directoryCopyLimits = resolveDirectoryCopyLimits(
		options.directoryCopyLimitsForTest,
	);
	installDirectoryCopyFixtureForTest(
		trees,
		options.directoryCopyFixtureForTest,
	);
	const workspaceDeleteLimits = resolveWorkspaceDeleteLimits(
		options.workspaceDeleteLimitsForTest,
	);
	const scriptedWorkspaceTrashResults = [
		...(options.workspaceTrashResultsForTest ?? []),
	].map(frozenWorkspaceTrashResult);
	const deleteMetadata = new WeakMap<MockNode, MockDeleteMetadata>();
	const workspaceWriteIdentities = new WeakMap<MockNode, number>();
	let nextWorkspaceWriteIdentity = 1;
	const initialLinkCounts = new Map<MockNode, number>();
	const countedDirectories = new Set<MockDirectoryNode>();
	const pendingDirectories = [...trees.values()];
	for (const root of pendingDirectories) {
		initialLinkCounts.set(root, (initialLinkCounts.get(root) ?? 0) + 1);
	}
	while (pendingDirectories.length > 0) {
		const directory = pendingDirectories.pop()!;
		if (countedDirectories.has(directory)) {
			continue;
		}
		countedDirectories.add(directory);
		if (!workspaceWriteIdentities.has(directory)) {
			workspaceWriteIdentities.set(directory, nextWorkspaceWriteIdentity++);
		}
		for (const child of directory.entries.values()) {
			if (!workspaceWriteIdentities.has(child)) {
				workspaceWriteIdentities.set(child, nextWorkspaceWriteIdentity++);
			}
			initialLinkCounts.set(child, (initialLinkCounts.get(child) ?? 0) + 1);
			if (child.kind === "directory") {
				pendingDirectories.push(child);
			}
		}
	}
	for (const [node, nlink] of initialLinkCounts) {
		deleteMetadata.set(node, {
			mode:
				node.kind === "directory"
					? 0o755
					: node.kind === "symlink"
						? 0o777
						: 0o644,
			version: 1,
			nlink,
		});
	}
	let revision = 0;
	let recentRevision = 1;
	let nextRecentId = 1;
	let recentEntries: Array<
		Readonly<{
			entry: WorkspaceRecentEntry;
			roots: readonly WorkspaceRoot[];
		}>
	> = [];
	const issuedDeleteIds = new Set<string>();
	let activeDeleteBatch: MockDeleteBatch | undefined;
	let activeTrashBatch: MockTrashBatch | undefined;
	let workspaceWriteInFlight = false;
	let workspaceWriteWindowIsClosed = false;
	let workspaceWriteAncestorGeneration = 0;
	let pendingWorkspaceWindowClose = false;
	const pendingWorkspaceRootRevocations = new Set<string>();
	const workspaceWatchWakeListeners = new Set<
		(wake: WorkspaceWatchWakeEvent) => void
	>();
	const workspaceWatchStates = new Map<
		string,
		{
			nextGeneration: number;
			pending: WorkspaceWatchPendingRoot | undefined;
			dirty: boolean;
			dirtyRescanRequired: boolean;
		}
	>();
	const workspaceWatchState = (rootId: string) => {
		let state = workspaceWatchStates.get(rootId);
		if (state === undefined) {
			state = {
				nextGeneration: 1,
				pending: undefined,
				dirty: false,
				dirtyRescanRequired: false,
			};
			workspaceWatchStates.set(rootId, state);
		}
		return state;
	};
	const promoteWorkspaceWatchDirty = (
		rootId: string,
		state: ReturnType<typeof workspaceWatchState>,
	): void => {
		if (state.pending !== undefined || !state.dirty) {
			return;
		}
		const generation = state.nextGeneration;
		state.nextGeneration = Math.min(0xffff_ffff, generation + 1);
		state.pending = Object.freeze({
			rootId,
			generation,
			rescanRequired: state.dirtyRescanRequired,
		});
		state.dirty = false;
		state.dirtyRescanRequired = false;
	};
	const emitWorkspaceWatchWake = (): void => {
		const wake = decodeWorkspaceWatchWakeEvent({
			workspaceId: MOCK_WORKSPACE_ID,
		});
		for (const listener of workspaceWatchWakeListeners) {
			listener(wake);
		}
	};
	const dirtyWorkspaceWatchRoot = (
		rootId: string,
		rescanRequired: boolean,
		emitWake: boolean,
	): void => {
		const state = workspaceWatchState(rootId);
		state.dirty = true;
		state.dirtyRescanRequired ||= rescanRequired;
		promoteWorkspaceWatchDirty(rootId, state);
		if (emitWake) {
			emitWorkspaceWatchWake();
		}
	};
	const workspaceWatchTransport: WorkspaceWatcherTransport = {
		async listenWake(listener) {
			workspaceWatchWakeListeners.add(listener);
			return (): void => {
				workspaceWatchWakeListeners.delete(listener);
			};
		},
		async sync(candidate: WorkspaceWatchSyncRequest) {
			const request = frozenWorkspaceWatchSyncRequest(candidate.roots);
			const pendingRoots: WorkspaceWatchPendingRoot[] = [];
			for (const root of request.roots) {
				if (!roots.has(root.rootId)) {
					continue;
				}
				const state = workspaceWatchState(root.rootId);
				if (
					root.acknowledgedGeneration === null &&
					state.pending === undefined
				) {
					state.dirty = true;
					state.dirtyRescanRequired = true;
				} else if (state.pending?.generation === root.acknowledgedGeneration) {
					if (root.acknowledgedGeneration === 0xffff_ffff) {
						state.pending = Object.freeze({
							...state.pending,
							rescanRequired: true,
						});
					} else {
						state.pending = undefined;
					}
				}
				promoteWorkspaceWatchDirty(root.rootId, state);
				if (state.pending !== undefined) {
					pendingRoots.push(state.pending);
				}
			}
			return decodeWorkspaceWatchSyncResult(
				{
					workspaceId: MOCK_WORKSPACE_ID,
					roots: pendingRoots,
				},
				request,
			);
		},
	};
	const workspaceWatcher = createWorkspaceWatcherManager(
		workspaceWatchTransport,
	);
	const workspaceWatchController = Object.freeze({
		invalidateRoot(
			rootId: string,
			invalidation: BrowserMockWorkspaceWatchInvalidationForTest = {},
		): void {
			if (!roots.has(rootId)) {
				throw rootNotAuthorized();
			}
			if (
				typeof invalidation !== "object" ||
				invalidation === null ||
				Object.getPrototypeOf(invalidation) !== Object.prototype ||
				Reflect.ownKeys(invalidation).some(
					(key) => key !== "emitWake" && key !== "rescanRequired",
				) ||
				(invalidation.emitWake !== undefined &&
					typeof invalidation.emitWake !== "boolean") ||
				(invalidation.rescanRequired !== undefined &&
					typeof invalidation.rescanRequired !== "boolean")
			) {
				throw new TypeError(
					"Invalid browser mock workspace-watch invalidation.",
				);
			}
			dirtyWorkspaceWatchRoot(
				rootId,
				invalidation.rescanRequired ?? false,
				invalidation.emitWake ?? true,
			);
		},
	} satisfies BrowserMockWorkspaceWatchControllerForTest);
	captureWorkspaceWatchController?.(workspaceWatchController);

	const registerDeleteMetadata = (node: MockNode): void => {
		const counts = new Map<MockNode, number>();
		const directories = new Set<MockDirectoryNode>();
		const pending: MockNode[] = [node];
		counts.set(node, 1);
		while (pending.length > 0) {
			const current = pending.pop()!;
			if (current.kind !== "directory" || directories.has(current)) {
				continue;
			}
			directories.add(current);
			for (const child of current.entries.values()) {
				counts.set(child, (counts.get(child) ?? 0) + 1);
				pending.push(child);
			}
		}
		for (const [current, count] of counts) {
			if (!workspaceWriteIdentities.has(current)) {
				workspaceWriteIdentities.set(current, nextWorkspaceWriteIdentity++);
			}
			const metadata = deleteMetadata.get(current);
			if (metadata === undefined) {
				deleteMetadata.set(current, {
					mode:
						current.kind === "directory"
							? 0o755
							: current.kind === "symlink"
								? 0o777
								: 0o644,
					version: 1,
					nlink: count,
				});
			} else {
				metadata.nlink += count;
				metadata.version += 1;
			}
		}
	};
	const metadataFor = (node: MockNode): MockDeleteMetadata => {
		const metadata = deleteMetadata.get(node);
		if (metadata === undefined) {
			throw new Error("Missing browser mock delete metadata.");
		}
		return metadata;
	};
	const metadataSnapshot = (node: MockNode): MockDeleteMetadataSnapshot => {
		const metadata = metadataFor(node);
		return Object.freeze({
			mode: metadata.mode,
			version: metadata.version,
			nlink: metadata.nlink,
		});
	};
	const touchDeleteNode = (node: MockNode): void => {
		metadataFor(node).version += 1;
	};
	const unlinkDeleteNode = (node: MockNode): void => {
		const metadata = metadataFor(node);
		metadata.nlink = Math.max(0, metadata.nlink - 1);
		metadata.version += 1;
	};
	const nextDeleteId = (): string => {
		for (let attempt = 0; attempt < 16; attempt += 1) {
			const bytes = new Uint8Array(16);
			globalThis.crypto.getRandomValues(bytes);
			bytes[6] = (bytes[6]! & 0x0f) | 0x40;
			bytes[8] = (bytes[8]! & 0x3f) | 0x80;
			const hex = [...bytes]
				.map((value) => value.toString(16).padStart(2, "0"))
				.join("");
			const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
				12,
				16,
			)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
			if (!issuedDeleteIds.has(id)) {
				issuedDeleteIds.add(id);
				return id;
			}
		}
		throw new Error("Browser mock workspace-delete id generation failed.");
	};
	const deleteNow = (): number => {
		const value = workspaceDeleteSeams.clock();
		if (!Number.isSafeInteger(value) || value < 0) {
			throw workspaceDeletePlanInvalid();
		}
		return value;
	};
	const trashNow = (): number => {
		const value = workspaceDeleteSeams.clock();
		if (!Number.isSafeInteger(value) || value < 0) {
			throw workspaceTrashPlanInvalid();
		}
		return value;
	};
	const expireDeleteBatch = (now: number): void => {
		if (activeDeleteBatch !== undefined && now >= activeDeleteBatch.deadline) {
			activeDeleteBatch = undefined;
		}
		if (activeTrashBatch !== undefined && now >= activeTrashBatch.deadline) {
			activeTrashBatch = undefined;
		}
	};
	const invalidateDeleteBatch = (): void => {
		activeDeleteBatch = undefined;
		activeTrashBatch = undefined;
	};

	const snapshot = () =>
		frozenWorkspaceSnapshot(MOCK_WORKSPACE_ID, revision, [...roots.values()]);
	const recordRecent = (): void => {
		const currentRoots = [...roots.values()];
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
		const rootLabels = Object.freeze(
			currentRoots.map(({ displayName }) => displayName),
		);
		const first = rootLabels[0]!;
		const entry = Object.freeze({
			recentId,
			label:
				rootLabels.length === 1
					? first
					: `${first} + ${rootLabels.length - 1} folders`,
			rootLabels,
		}) satisfies WorkspaceRecentEntry;
		recentEntries.unshift(
			Object.freeze({ entry, roots: Object.freeze([...currentRoots]) }),
		);
		recentEntries = recentEntries.slice(0, 20);
	};
	const resolveNode = (rootId: string, relativePath: string): MockNode => {
		const request = frozenWorkspaceEntryRequest(rootId, relativePath);
		if (!roots.has(request.rootId)) {
			throw rootNotAuthorized();
		}
		const root = trees.get(request.rootId);
		if (root === undefined) {
			throw rootNotAuthorized();
		}
		const segments = workspaceRelativePathSegments(request.relativePath);
		if (segments === undefined) {
			throw invalidRelativePath();
		}

		let node: MockNode = root;
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
		return node;
	};
	const resolveEntryForRead = (
		rootId: string,
		relativePath: string,
	): Readonly<{
		node: MockNode;
		kind: WorkspaceEntryKind;
		size: number;
		resolvedSegments: readonly string[];
		followedSymlink: boolean;
	}> => {
		let directNode: MockNode | undefined;
		let directError: unknown;
		try {
			directNode = resolveNode(rootId, relativePath);
		} catch (error) {
			if (
				(error as { readonly code?: unknown })?.code !== "ENTRY_TYPE_MISMATCH"
			) {
				throw error;
			}
			directError = error;
		}
		const request = frozenWorkspaceEntryRequest(rootId, relativePath);
		const root = trees.get(request.rootId);
		const segments = workspaceRelativePathSegments(request.relativePath);
		if (root === undefined || segments === undefined) {
			throw rootNotAuthorized();
		}
		const resolved = resolveMockPathFollowingSymlinks(root, segments);
		if (resolved === undefined) {
			if (directNode !== undefined && isMockSymlinkNode(directNode)) {
				return Object.freeze({
					node: directNode,
					kind: "symlink",
					size: directNode.payload.byteLength,
					resolvedSegments: segments,
					followedSymlink: true,
				});
			}
			throw directError ?? entryTypeMismatch();
		}

		let kind: WorkspaceEntryKind;
		let size = 0;
		if (resolved.finalSymlink !== undefined) {
			if (resolved.node.kind === "file") {
				kind = "symlinkFile";
				size = resolved.node.size;
			} else if (resolved.node.kind === "directory") {
				kind = "symlinkDirectory";
			} else {
				kind = "symlink";
				size = resolved.finalSymlink.payload.byteLength;
			}
		} else {
			kind = resolved.node.kind;
			if (resolved.node.kind === "file") {
				size = resolved.node.size;
			}
		}
		return Object.freeze({
			node: resolved.node,
			kind,
			size,
			resolvedSegments: resolved.resolvedSegments,
			followedSymlink: resolved.followedSymlink,
		});
	};
	const resolveCreateTarget = (
		rootId: string,
		relativePath: string,
	): Readonly<{ parent: MockDirectoryNode; name: string }> => {
		const request = frozenWorkspaceCreateEntryRequest(rootId, relativePath);
		if (!roots.has(request.rootId)) {
			throw rootNotAuthorized();
		}
		const root = trees.get(request.rootId);
		if (root === undefined) {
			throw rootNotAuthorized();
		}
		const segments = workspaceRelativePathSegments(request.relativePath);
		if (segments === undefined || segments.length === 0) {
			throw invalidRelativePath();
		}

		let parent = root;
		for (const segment of segments.slice(0, -1)) {
			const child = parent.entries.get(segment);
			if (child === undefined) {
				throw entryNotFound();
			}
			if (child.kind !== "directory") {
				throw entryTypeMismatch();
			}
			parent = child;
		}
		return Object.freeze({ parent, name: segments.at(-1)! });
	};
	const mockWorkspaceVersion = (
		rootId: string,
		relativePath: string,
		file: MockFileNode,
		metadata: MockDeleteMetadata,
	): string => {
		const hashes = [
			0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f, 0x165667b1,
			0xd3a2646c, 0xfd7046c5,
		];
		const feed = (bytes: Uint8Array): void => {
			for (let hashIndex = 0; hashIndex < hashes.length; hashIndex += 1) {
				let hash = hashes[hashIndex]!;
				const multiplier = 0x01000193 + hashIndex * 2;
				for (const byte of bytes) {
					hash = Math.imul(hash ^ byte, multiplier) >>> 0;
				}
				hashes[hashIndex] = hash;
			}
		};
		feed(
			textEncoder.encode(
				`plain.browser-mock.wv1\0${rootId}\0${relativePath}\0${workspaceWriteIdentities.get(file) ?? 0}\0${file.size}\0${metadata.mode}\0${metadata.version}\0${metadata.nlink}\0`,
			),
		);
		feed(file.bytes);
		return `wv1:${hashes
			.map((hash) => hash.toString(16).padStart(8, "0"))
			.join("")}`;
	};
	const writableVersionForEntry = (
		rootId: string,
		relativePath: string,
		entry: Readonly<{
			node: MockNode;
			kind: WorkspaceEntryKind;
			followedSymlink: boolean;
		}>,
	): string | null => {
		if (
			entry.kind !== "file" ||
			entry.node.kind !== "file" ||
			entry.followedSymlink ||
			entry.node.size > MAX_FILE_BYTES
		) {
			return null;
		}
		try {
			const target = resolveCreateTarget(rootId, relativePath);
			if (target.parent.entries.get(target.name) !== entry.node) {
				return null;
			}
			const metadata = metadataFor(entry.node);
			const parentMetadata = metadataFor(target.parent);
			if (
				metadata.nlink !== 1 ||
				(metadata.mode & 0o7000) !== 0 ||
				(metadata.mode & 0o200) === 0 ||
				(parentMetadata.mode & 0o7000) !== 0 ||
				(parentMetadata.mode & 0o022) !== 0 ||
				(parentMetadata.mode & 0o300) !== 0o300
			) {
				return null;
			}
			return mockWorkspaceVersion(rootId, relativePath, entry.node, metadata);
		} catch {
			return null;
		}
	};
	const writeMetadataMatches = (
		node: MockNode,
		expected: MockDeleteMetadataSnapshot,
	): boolean => {
		const actual = deleteMetadata.get(node);
		return (
			actual !== undefined &&
			actual.mode === expected.mode &&
			actual.version === expected.version &&
			actual.nlink === expected.nlink
		);
	};
	const writeBytesMatch = (
		file: MockFileNode,
		expected: Uint8Array,
	): boolean => {
		if (
			file.size !== expected.byteLength ||
			file.bytes.byteLength !== expected.byteLength
		) {
			return false;
		}
		for (let index = 0; index < expected.byteLength; index += 1) {
			if (file.bytes[index] !== expected[index]) {
				return false;
			}
		}
		return true;
	};
	const finishWorkspaceWriteGate = (): void => {
		workspaceWriteInFlight = false;
		for (const rootId of pendingWorkspaceRootRevocations) {
			if (roots.delete(rootId)) {
				revision += 1;
				invalidateDeleteBatch();
			}
		}
		pendingWorkspaceRootRevocations.clear();
		if (pendingWorkspaceWindowClose) {
			workspaceWriteWindowIsClosed = true;
			pendingWorkspaceWindowClose = false;
		}
	};
	const writeWorkspaceFile = (
		rootId: string,
		relativePath: string,
		expectedVersion: string,
		content: Uint8Array,
	): WorkspaceWriteResult => {
		if (workspaceWriteWindowIsClosed) {
			throw workspaceWindowClosed();
		}
		if (workspaceWriteInFlight) {
			throw workspaceWriteConflict();
		}
		const request = frozenWorkspaceCreateEntryRequest(rootId, relativePath);
		if (!roots.has(request.rootId)) {
			throw rootNotAuthorized();
		}

		const frame = encodeWorkspaceWriteFileRequest(
			request.rootId,
			request.relativePath,
			expectedVersion,
			content,
		);
		const contentLength = new DataView(
			frame.buffer,
			frame.byteOffset,
			frame.byteLength,
		).getUint32(10, false);
		const contentSnapshot = frame.slice(frame.byteLength - contentLength);

		workspaceWriteInFlight = true;
		let ownStage: MockFileNode | undefined;
		try {
			let targetLocation: Readonly<{
				parent: MockDirectoryNode;
				name: string;
			}>;
			try {
				targetLocation = resolveCreateTarget(
					request.rootId,
					request.relativePath,
				);
			} catch (error) {
				if (
					(error as { readonly code?: unknown })?.code === "ENTRY_TYPE_MISMATCH"
				) {
					throw workspaceWriteUnsupported();
				}
				throw error;
			}
			const oldTarget = targetLocation.parent.entries.get(targetLocation.name);
			if (oldTarget === undefined) {
				throw workspaceFileChanged();
			}
			if (oldTarget.kind !== "file") {
				throw workspaceWriteUnsupported();
			}
			const currentVersion = writableVersionForEntry(
				request.rootId,
				request.relativePath,
				Object.freeze({
					node: oldTarget,
					kind: "file" as const,
					followedSymlink: false,
				}),
			);
			if (currentVersion === null) {
				throw workspaceWriteUnsupported();
			}
			if (currentVersion !== expectedVersion) {
				throw workspaceFileChanged();
			}

			const oldTargetMetadata = metadataSnapshot(oldTarget);
			const parentMetadata = metadataSnapshot(targetLocation.parent);
			const initialAncestorGeneration = workspaceWriteAncestorGeneration;
			const stage = Object.freeze({
				kind: "file" as const,
				size: contentSnapshot.byteLength,
				bytes: contentSnapshot,
			});
			ownStage = stage;
			workspaceWriteIdentities.set(stage, nextWorkspaceWriteIdentity++);
			deleteMetadata.set(stage, {
				mode: oldTargetMetadata.mode,
				version: oldTargetMetadata.version + 1,
				nlink: 1,
			});
			const ownStageMetadata = metadataSnapshot(stage);
			let stageNamespace: MockFileNode | undefined = stage;
			let stageWasPublished = false;
			let forceTargetUnverifiable = false;
			let phase: BrowserMockWorkspaceWriteObservation["phase"] =
				"beforePublication";

			const currentLocation = () => {
				if (!roots.has(request.rootId)) {
					return undefined;
				}
				try {
					const current = resolveCreateTarget(
						request.rootId,
						request.relativePath,
					);
					return current.parent === targetLocation.parent &&
						current.name === targetLocation.name
						? current
						: undefined;
				} catch {
					return undefined;
				}
			};
			const parentPathReceiptMatches = (): boolean =>
				workspaceWriteAncestorGeneration === initialAncestorGeneration &&
				currentLocation() !== undefined;
			const prepublicationParentReceiptMatches = (): boolean =>
				parentPathReceiptMatches() &&
				writeMetadataMatches(targetLocation.parent, parentMetadata);
			const oldTargetReceiptMatches = (): boolean => {
				const location = currentLocation();
				return (
					location !== undefined &&
					prepublicationParentReceiptMatches() &&
					location.parent.entries.get(location.name) === oldTarget &&
					writeMetadataMatches(oldTarget, oldTargetMetadata) &&
					mockWorkspaceVersion(
						request.rootId,
						request.relativePath,
						oldTarget,
						metadataFor(oldTarget),
					) === expectedVersion
				);
			};
			const ownStageReceiptMatches = (): boolean =>
				stageNamespace === stage &&
				writeMetadataMatches(stage, ownStageMetadata) &&
				writeBytesMatch(stage, contentSnapshot);
			const observeTarget = ():
				"matchesWritten" | "changed" | "unverifiable" => {
				if (forceTargetUnverifiable || !parentPathReceiptMatches()) {
					return "unverifiable";
				}
				const current = targetLocation.parent.entries.get(targetLocation.name);
				if (
					current === stage &&
					writeMetadataMatches(stage, ownStageMetadata) &&
					writeBytesMatch(stage, contentSnapshot)
				) {
					return "matchesWritten";
				}
				return "changed";
			};
			const replacementFile = (bytes: readonly number[]): MockFileNode => {
				const replacementBytes = strictMockBytes(bytes);
				const replacement = Object.freeze({
					kind: "file" as const,
					size: replacementBytes.byteLength,
					bytes: replacementBytes,
				});
				registerDeleteMetadata(replacement);
				return replacement;
			};
			const publishStage = (): void => {
				if (phase !== "rename" || stageNamespace === undefined) {
					throw new Error("Invalid browser mock workspace-write publication.");
				}
				const current = targetLocation.parent.entries.get(targetLocation.name);
				if (current !== undefined) {
					unlinkDeleteNode(current);
				}
				targetLocation.parent.entries.set(targetLocation.name, stageNamespace);
				touchDeleteNode(targetLocation.parent);
				stageWasPublished = true;
				stageNamespace = undefined;
			};
			const writeMutations = Object.freeze({
				rewriteTarget(bytes: readonly number[]): void {
					const current = targetLocation.parent.entries.get(
						targetLocation.name,
					);
					const replacement = strictMockBytes(bytes);
					if (
						current?.kind !== "file" ||
						current.bytes.byteLength !== replacement.byteLength
					) {
						throw new Error("Invalid browser mock workspace-write mutation.");
					}
					current.bytes.set(replacement);
					touchDeleteNode(current);
				},
				replaceTarget(bytes: readonly number[]): void {
					const current = targetLocation.parent.entries.get(
						targetLocation.name,
					);
					if (current === undefined) {
						throw new Error("Invalid browser mock workspace-write mutation.");
					}
					const replacement = replacementFile(bytes);
					targetLocation.parent.entries.set(targetLocation.name, replacement);
					unlinkDeleteNode(current);
					touchDeleteNode(targetLocation.parent);
				},
				rewriteStage(bytes: readonly number[]): void {
					const replacement = strictMockBytes(bytes);
					if (
						stageNamespace === undefined ||
						stageNamespace.bytes.byteLength !== replacement.byteLength
					) {
						throw new Error("Invalid browser mock workspace-write mutation.");
					}
					stageNamespace.bytes.set(replacement);
					touchDeleteNode(stageNamespace);
				},
				replaceStage(bytes: readonly number[]): void {
					if (stageNamespace === undefined) {
						throw new Error("Invalid browser mock workspace-write mutation.");
					}
					const replacement = replacementFile(bytes);
					unlinkDeleteNode(stageNamespace);
					stageNamespace = replacement;
				},
				changeAncestor(): void {
					workspaceWriteAncestorGeneration += 1;
				},
				publishStage,
				markTargetUnverifiable(): void {
					forceTargetUnverifiable = true;
				},
				revokeRoot(): void {
					pendingWorkspaceRootRevocations.add(request.rootId);
				},
				closeWindow(): void {
					pendingWorkspaceWindowClose = true;
				},
			} satisfies BrowserMockWorkspaceWriteMutationsForTest);
			const observation = () =>
				Object.freeze({
					phase,
					rootId: request.rootId,
					relativePath: request.relativePath,
					expectedVersion,
					contentLength,
				} satisfies BrowserMockWorkspaceWriteObservation);

			try {
				workspaceWriteSeams.beforePublication?.(observation(), writeMutations);
			} catch {
				throw workspaceWriteFailed();
			}
			if (!prepublicationParentReceiptMatches()) {
				throw workspaceWriteConflict();
			}
			if (!oldTargetReceiptMatches()) {
				throw workspaceWriteConflict();
			}
			if (!ownStageReceiptMatches()) {
				throw workspaceWriteConflict();
			}

			phase = "rename";
			let rename: "reportedSuccess" | "reportedFailure";
			try {
				const reported = workspaceWriteSeams.rename?.(
					observation(),
					writeMutations,
				);
				if (
					reported !== undefined &&
					reported !== "reportedSuccess" &&
					reported !== "reportedFailure"
				) {
					throw new Error(
						"Invalid browser mock workspace-write rename result.",
					);
				}
				rename = reported ?? "reportedSuccess";
				if (rename === "reportedSuccess" && !stageWasPublished) {
					publishStage();
				}
			} catch {
				return workspaceWriteResponseUnavailable();
			}

			let targetObservedWritten =
				rename === "reportedFailure" && observeTarget() === "matchesWritten";
			if (
				rename === "reportedFailure" &&
				!stageWasPublished &&
				oldTargetReceiptMatches() &&
				ownStageReceiptMatches()
			) {
				unlinkDeleteNode(stage);
				stageNamespace = undefined;
				throw workspaceWriteFailed();
			}
			if (rename === "reportedFailure" && !targetObservedWritten) {
				return frozenWorkspaceWriteResult(
					{
						status: "outcomeUnknown",
						observation: "native",
						rename: "reportedFailure",
						directorySync: "notAttempted",
						target: "ambiguous",
					},
					expectedVersion,
					contentLength,
				);
			}

			phase = "directorySync";
			let directorySync: "synced" | "failed" = "synced";
			try {
				const reported = workspaceWriteSeams.directorySync?.(
					observation(),
					writeMutations,
				);
				if (
					reported !== undefined &&
					reported !== "synced" &&
					reported !== "failed"
				) {
					throw new Error(
						"Invalid browser mock workspace-write directory-sync result.",
					);
				}
				if (reported !== undefined) {
					directorySync = reported;
				}
			} catch {
				directorySync = "failed";
			}

			phase = "afterPublication";
			let targetOverride: BrowserMockWorkspaceWriteTargetResult;
			try {
				targetOverride = workspaceWriteSeams.afterPublication?.(
					observation(),
					writeMutations,
				);
				if (
					targetOverride !== undefined &&
					targetOverride !== "matchesWritten" &&
					targetOverride !== "changed" &&
					targetOverride !== "unverifiable"
				) {
					throw new Error(
						"Invalid browser mock workspace-write target result.",
					);
				}
			} catch {
				targetOverride = "unverifiable";
			}
			let target = observeTarget();
			if (targetOverride === "changed" || targetOverride === "unverifiable") {
				target = targetOverride;
			} else if (
				targetOverride === "matchesWritten" &&
				target !== "matchesWritten"
			) {
				target = "unverifiable";
			}
			if (target === "matchesWritten") {
				targetObservedWritten = true;
			}

			if (
				rename === "reportedSuccess" &&
				directorySync === "synced" &&
				target === "matchesWritten"
			) {
				const version = mockWorkspaceVersion(
					request.rootId,
					request.relativePath,
					stage,
					metadataFor(stage),
				);
				if (version !== expectedVersion) {
					return frozenWorkspaceWriteResult(
						{
							status: "written",
							stat: frozenWorkspaceEntryStat(
								"file",
								contentLength,
								MOCK_MTIME,
								MOCK_CTIME,
								version,
							),
						},
						expectedVersion,
						contentLength,
					);
				}
				target = "unverifiable";
			}

			if (rename === "reportedFailure") {
				return frozenWorkspaceWriteResult(
					{
						status: "targetPublished",
						publicationEvidence: "targetObservedWritten",
						rename,
						directorySync,
						target,
					},
					expectedVersion,
					contentLength,
				);
			}
			if (target === "matchesWritten") {
				if (directorySync !== "failed") {
					return workspaceWriteResponseUnavailable();
				}
				return frozenWorkspaceWriteResult(
					{
						status: "targetPublished",
						publicationEvidence: "targetObservedWritten",
						rename,
						directorySync,
						target,
					},
					expectedVersion,
					contentLength,
				);
			}
			return frozenWorkspaceWriteResult(
				{
					status: "targetPublished",
					publicationEvidence: "renameReportedSuccess",
					rename,
					directorySync,
					target,
				},
				expectedVersion,
				contentLength,
			);
		} finally {
			if (ownStage !== undefined && metadataFor(ownStage).nlink > 0) {
				const location = (() => {
					try {
						return resolveCreateTarget(request.rootId, request.relativePath);
					} catch {
						return undefined;
					}
				})();
				if (location?.parent.entries.get(location.name) !== ownStage) {
					unlinkDeleteNode(ownStage);
				}
			}
			finishWorkspaceWriteGate();
		}
	};
	const strictMockBytes = (bytes: readonly number[]): Uint8Array => {
		if (
			!Array.isArray(bytes) ||
			bytes.some(
				(value) =>
					typeof value !== "number" ||
					!Number.isInteger(value) ||
					value < 0 ||
					value > 255,
			)
		) {
			throw new Error("Invalid browser mock workspace-delete mutation.");
		}
		return Uint8Array.from(bytes);
	};
	const deleteObserverTouchedNodes = new Set<MockNode>();
	const deleteMutations = Object.freeze({
		rewriteFile(
			rootId: string,
			relativePath: string,
			bytes: readonly number[],
		): void {
			const node = resolveNode(rootId, relativePath);
			const replacement = strictMockBytes(bytes);
			if (
				node.kind !== "file" ||
				node.bytes.byteLength !== replacement.length
			) {
				throw new Error("Invalid browser mock workspace-delete mutation.");
			}
			node.bytes.set(replacement);
			touchDeleteNode(node);
			deleteObserverTouchedNodes.add(node);
		},
		replaceFile(
			rootId: string,
			relativePath: string,
			bytes: readonly number[],
		): void {
			const target = resolveCreateTarget(rootId, relativePath);
			const current = target.parent.entries.get(target.name);
			if (current === undefined) {
				throw new Error("Invalid browser mock workspace-delete mutation.");
			}
			const replacementBytes = strictMockBytes(bytes);
			const replacement = Object.freeze({
				kind: "file" as const,
				size: replacementBytes.byteLength,
				bytes: replacementBytes,
			});
			registerDeleteMetadata(replacement);
			target.parent.entries.set(target.name, replacement);
			unlinkDeleteNode(current);
			touchDeleteNode(target.parent);
			deleteObserverTouchedNodes.add(current);
			deleteObserverTouchedNodes.add(target.parent);
		},
		addFile(
			rootId: string,
			relativePath: string,
			bytes: readonly number[],
		): void {
			const target = resolveCreateTarget(rootId, relativePath);
			if (target.parent.entries.has(target.name)) {
				throw new Error("Invalid browser mock workspace-delete mutation.");
			}
			const fileBytes = strictMockBytes(bytes);
			const file = Object.freeze({
				kind: "file" as const,
				size: fileBytes.byteLength,
				bytes: fileBytes,
			});
			registerDeleteMetadata(file);
			target.parent.entries.set(target.name, file);
			touchDeleteNode(target.parent);
			deleteObserverTouchedNodes.add(target.parent);
		},
		addHardlink(rootId: string, sourcePath: string, targetPath: string): void {
			const source = resolveNode(rootId, sourcePath);
			const target = resolveCreateTarget(rootId, targetPath);
			if (source.kind !== "file" || target.parent.entries.has(target.name)) {
				throw new Error("Invalid browser mock workspace-delete mutation.");
			}
			target.parent.entries.set(target.name, source);
			const metadata = metadataFor(source);
			metadata.nlink += 1;
			metadata.version += 1;
			touchDeleteNode(target.parent);
			deleteObserverTouchedNodes.add(source);
			deleteObserverTouchedNodes.add(target.parent);
		},
		removeEntry(rootId: string, relativePath: string): void {
			const target = resolveCreateTarget(rootId, relativePath);
			const current = target.parent.entries.get(target.name);
			if (current === undefined) {
				throw new Error("Invalid browser mock workspace-delete mutation.");
			}
			target.parent.entries.delete(target.name);
			unlinkDeleteNode(current);
			touchDeleteNode(target.parent);
			deleteObserverTouchedNodes.add(current);
			deleteObserverTouchedNodes.add(target.parent);
		},
		chmod(rootId: string, relativePath: string, mode: number): void {
			if (!Number.isSafeInteger(mode) || mode < 0 || mode > 0o7777) {
				throw new Error("Invalid browser mock workspace-delete mutation.");
			}
			const node = resolveNode(rootId, relativePath);
			const metadata = metadataFor(node);
			metadata.mode = mode;
			metadata.version += 1;
			deleteObserverTouchedNodes.add(node);
		},
	}) satisfies BrowserMockWorkspaceDeleteMutationsForTest;
	interface DeleteCaptureBudget {
		descendants: number;
		namePayloadBytes: number;
		symlinkPayloadBytes: number;
	}
	const captureDeleteReceipt = (
		node: MockNode,
		parentPath: string,
		depth: number,
		budget: DeleteCaptureBudget,
	): MockDeleteReceipt => {
		if (node.kind === "file") {
			return Object.freeze({
				kind: node.kind,
				identity: node,
				size: node.size,
				metadata: metadataSnapshot(node),
			});
		}
		if (isMockSymlinkNode(node)) {
			if (
				node.payload.byteLength > workspaceDeleteLimits.symlinkBytes ||
				budget.symlinkPayloadBytes + node.payload.byteLength >
					workspaceDeleteLimits.totalSymlinkBytes
			) {
				throw symlinkTooLarge();
			}
			budget.symlinkPayloadBytes += node.payload.byteLength;
			return Object.freeze({
				kind: node.kind,
				identity: node,
				payload: immutableMockBytes(node.payload.copy()),
				metadata: metadataSnapshot(node),
			});
		}
		if (node.kind !== "directory") {
			throw entryTypeMismatch();
		}
		const entries: MockDeleteReceiptEntry[] = [];
		for (const [name, child] of [...node.entries].sort(([left], [right]) =>
			compareWorkspaceEntryNames(left, right),
		)) {
			const childDepth = depth + 1;
			const nameBytes = textEncoder.encode(name).byteLength;
			if (
				childDepth > workspaceDeleteLimits.depth ||
				budget.descendants >= workspaceDeleteLimits.descendants ||
				nameBytes > MAX_DIRECTORY_COPY_NAME_BYTES ||
				budget.namePayloadBytes + nameBytes >
					workspaceDeleteLimits.namePayloadBytes
			) {
				throw directoryCopyTooLarge();
			}
			if (!isPortableWorkspaceEntryName(name)) {
				throw pathEncodingUnsupported();
			}
			const relativePath =
				parentPath.length === 0 ? name : `${parentPath}/${name}`;
			if (workspaceRelativePathSegments(relativePath) === undefined) {
				throw pathEncodingUnsupported();
			}
			budget.descendants += 1;
			budget.namePayloadBytes += nameBytes;
			entries.push(
				Object.freeze({
					name,
					relativePath,
					depth: childDepth,
					parentIdentity: node,
					parentEntryCount: node.entries.size,
					receipt: captureDeleteReceipt(
						child,
						relativePath,
						childDepth,
						budget,
					),
				}),
			);
		}
		return Object.freeze({
			kind: node.kind,
			identity: node,
			metadata: metadataSnapshot(node),
			entries: Object.freeze(entries),
		});
	};
	const metadataEqual = (
		left: MockDeleteMetadata,
		right: MockDeleteMetadataSnapshot,
	): boolean =>
		left.mode === right.mode &&
		left.version === right.version &&
		left.nlink === right.nlink;
	const matchesDeleteReceipt = (
		node: MockNode,
		receipt: MockDeleteReceipt,
		journal: MockDeleteJournal | undefined,
	): boolean => {
		workspaceDeleteSeams.receiptVisit?.();
		if (node !== receipt.identity || node.kind !== receipt.kind) {
			return false;
		}
		const expected = journal?.expectedMetadata.get(node) ?? receipt.metadata;
		if (!metadataEqual(metadataFor(node), expected)) {
			return false;
		}
		if (receipt.kind === "file") {
			return node.kind === "file" && node.size === receipt.size;
		}
		if (receipt.kind === "symlink") {
			return (
				isMockSymlinkNode(node) &&
				mockBytesEqual(node.payload.copy(), receipt.payload.copy())
			);
		}
		if (node.kind !== "directory") {
			return false;
		}
		const expectedEntries = receipt.entries.filter(
			(entry) => !journal?.removedPaths.has(entry.relativePath),
		);
		if (node.entries.size !== expectedEntries.length) {
			return false;
		}
		return expectedEntries.every((entry) => {
			const child = node.entries.get(entry.name);
			return (
				child !== undefined &&
				matchesDeleteReceipt(child, entry.receipt, journal)
			);
		});
	};
	const matchesDeleteTop = (
		top: MockDeleteTopReceipt,
		journal?: MockDeleteJournal,
	): boolean => {
		try {
			const target = resolveCreateTarget(
				top.request.rootId,
				top.request.relativePath,
			);
			const node = target.parent.entries.get(target.name);
			return (
				target.parent === top.parentIdentity &&
				target.name === top.name &&
				node !== undefined &&
				matchesDeleteReceipt(node, top.receipt, journal)
			);
		} catch {
			return false;
		}
	};
	const captureTrashReceipt = (node: MockNode): MockTrashReceipt => {
		if (node.kind === "file") {
			return Object.freeze({
				kind: node.kind,
				identity: node,
				metadata: metadataSnapshot(node),
				size: node.size,
			});
		}
		if (isMockSymlinkNode(node)) {
			if (node.payload.byteLength > 4 * 1_024) {
				throw symlinkTooLarge();
			}
			return Object.freeze({
				kind: node.kind,
				identity: node,
				metadata: metadataSnapshot(node),
				payload: immutableMockBytes(node.payload.copy()),
			});
		}
		if (node.kind !== "directory") {
			throw entryTypeMismatch();
		}
		return Object.freeze({
			kind: node.kind,
			identity: node,
			metadata: metadataSnapshot(node),
		});
	};
	const matchesTrashReceipt = (
		node: MockNode,
		receipt: MockTrashReceipt,
	): boolean => {
		if (
			node !== receipt.identity ||
			node.kind !== receipt.kind ||
			!metadataEqual(metadataFor(node), receipt.metadata)
		) {
			return false;
		}
		if (receipt.kind === "file") {
			return node.kind === "file" && node.size === receipt.size;
		}
		if (receipt.kind === "symlink") {
			return (
				isMockSymlinkNode(node) &&
				mockBytesEqual(node.payload.copy(), receipt.payload.copy())
			);
		}
		return node.kind === "directory";
	};
	const matchesTrashTop = (top: MockTrashTopReceipt): boolean => {
		try {
			const target = resolveCreateTarget(
				top.request.rootId,
				top.request.relativePath,
			);
			const node = target.parent.entries.get(target.name);
			return (
				target.parent === top.parentIdentity &&
				target.name === top.name &&
				node !== undefined &&
				matchesTrashReceipt(node, top.receipt)
			);
		} catch {
			return false;
		}
	};
	const collectDeleteExpectedMetadata = (
		receipt: MockDeleteReceipt,
		target: Map<MockNode, MockDeleteMetadataSnapshot>,
	): void => {
		if (!target.has(receipt.identity)) {
			target.set(receipt.identity, receipt.metadata);
		}
		if (receipt.kind === "directory") {
			for (const entry of receipt.entries) {
				collectDeleteExpectedMetadata(entry.receipt, target);
			}
		}
	};
	const collectDeleteReceiptIdentities = (
		receipt: MockDeleteReceipt,
	): ReadonlySet<MockNode> => {
		const identities = new Set<MockNode>();
		const pending: MockDeleteReceipt[] = [receipt];
		while (pending.length > 0) {
			const current = pending.pop()!;
			identities.add(current.identity);
			if (current.kind === "directory") {
				for (const entry of current.entries) {
					pending.push(entry.receipt);
				}
			}
		}
		return identities;
	};
	const flattenDeleteReceipt = (
		receipt: MockDeleteReceipt,
	): readonly MockDeleteReceiptEntry[] => {
		if (receipt.kind !== "directory") {
			return Object.freeze([]);
		}
		const flattened: MockDeleteReceiptEntry[] = [];
		const pending = [...receipt.entries].reverse();
		while (pending.length > 0) {
			const entry = pending.pop()!;
			flattened.push(entry);
			if (entry.receipt.kind === "directory") {
				for (const child of [...entry.receipt.entries].reverse()) {
					pending.push(child);
				}
			}
		}
		return Object.freeze(flattened);
	};
	const createEntry = (
		rootId: string,
		relativePath: string,
		entry: MockNode,
	): void => {
		const { parent, name } = resolveCreateTarget(rootId, relativePath);
		if (parent.entries.has(name)) {
			throw entryAlreadyExists();
		}
		registerDeleteMetadata(entry);
		parent.entries.set(name, entry);
		touchDeleteNode(parent);
	};
	const renameEntry = (
		rootId: string,
		sourcePath: string,
		targetPath: string,
	): void => {
		const request = frozenWorkspaceRenameRequest(
			rootId,
			sourcePath,
			targetPath,
		);
		if (!roots.has(request.rootId) || !trees.has(request.rootId)) {
			throw rootNotAuthorized();
		}

		const sourceTarget = resolveCreateTarget(
			request.rootId,
			request.sourcePath,
		);
		const source = sourceTarget.parent.entries.get(sourceTarget.name);
		if (source === undefined) {
			throw entryNotFound();
		}

		const target = resolveCreateTarget(request.rootId, request.targetPath);
		if (target.parent.entries.has(target.name)) {
			throw entryAlreadyExists();
		}

		sourceTarget.parent.entries.delete(sourceTarget.name);
		target.parent.entries.set(target.name, source);
		touchDeleteNode(source);
		touchDeleteNode(sourceTarget.parent);
		if (target.parent !== sourceTarget.parent) {
			touchDeleteNode(target.parent);
		}
	};
	type MockCopyRequest = ReturnType<typeof frozenWorkspaceCopyRequest>;
	interface PreparedMockCopy {
		readonly request: MockCopyRequest;
		readonly source: MockNode;
		readonly sourceTarget: Readonly<{
			parent: MockDirectoryNode;
			name: string;
		}>;
		readonly target: Readonly<{
			parent: MockDirectoryNode;
			name: string;
		}>;
		readonly copied: MockNode;
		readonly directoryManifest?: BrowserMockDirectoryCopyManifestSummary;
	}
	const prepareCopyEntry = (request: MockCopyRequest): PreparedMockCopy => {
		if (
			!roots.has(request.sourceRootId) ||
			!trees.has(request.sourceRootId) ||
			!roots.has(request.targetRootId) ||
			!trees.has(request.targetRootId)
		) {
			throw rootNotAuthorized();
		}
		if (request.sourcePath.length === 0 || request.targetPath.length === 0) {
			throw entryTypeMismatch();
		}
		if (
			request.sourceRootId === request.targetRootId &&
			request.sourcePath === request.targetPath
		) {
			throw entryAlreadyExists();
		}
		const sourceSegments = workspaceRelativePathSegments(request.sourcePath);
		const targetSegments = workspaceRelativePathSegments(request.targetPath);
		if (sourceSegments === undefined || targetSegments === undefined) {
			throw invalidRelativePath();
		}
		if (
			request.sourceRootId === request.targetRootId &&
			targetSegments.length > sourceSegments.length &&
			sourceSegments.every(
				(segment, index) => targetSegments[index] === segment,
			)
		) {
			throw copyConflict();
		}

		const sourceTarget = resolveCreateTarget(
			request.sourceRootId,
			request.sourcePath,
		);
		const source = sourceTarget.parent.entries.get(sourceTarget.name);
		if (source === undefined) {
			throw entryNotFound();
		}
		let copied: MockNode;
		let directoryManifest: BrowserMockDirectoryCopyManifestSummary | undefined;
		if (source.kind === "file") {
			if (source.size > MAX_FILE_BYTES) {
				throw copyFileTooLarge();
			}
			copied = cloneMockNode(source);
		} else if (isMockSymlinkNode(source)) {
			if (source.payload.byteLength > MAX_SYMLINK_PAYLOAD_BYTES) {
				throw symlinkTooLarge();
			}
			copied = cloneMockNode(source);
		} else if (source.kind === "directory") {
			const detached = boundedDirectoryClone(
				source,
				sourceSegments,
				targetSegments,
				directoryCopyLimits,
			);
			copied = detached.node;
			directoryManifest = detached.manifest;
		} else {
			throw entryTypeMismatch();
		}

		const target = resolveCreateTarget(
			request.targetRootId,
			request.targetPath,
		);
		if (target.parent.entries.has(target.name)) {
			throw entryAlreadyExists();
		}
		return Object.freeze({
			request,
			source,
			sourceTarget,
			target,
			copied,
			...(directoryManifest === undefined ? {} : { directoryManifest }),
		});
	};
	const publishPreparedCopy = (prepared: PreparedMockCopy): void => {
		if (prepared.target.parent.entries.has(prepared.target.name)) {
			throw entryAlreadyExists();
		}
		registerDeleteMetadata(prepared.copied);
		prepared.target.parent.entries.set(prepared.target.name, prepared.copied);
		touchDeleteNode(prepared.target.parent);
	};
	const copyEntry = (
		sourceRootId: string,
		sourcePath: string,
		targetRootId: string,
		targetPath: string,
	): void => {
		const prepared = prepareCopyEntry(
			frozenWorkspaceCopyRequest(
				sourceRootId,
				sourcePath,
				targetRootId,
				targetPath,
			),
		);
		const { request, copied, directoryManifest } = prepared;
		if (directoryManifest !== undefined) {
			options.onDirectoryCopyForTest?.(
				Object.freeze({
					sourceRootId: request.sourceRootId,
					sourcePath: request.sourcePath,
					targetRootId: request.targetRootId,
					targetPath: request.targetPath,
					manifest: directoryManifest,
				}),
			);
		}
		if (isMockSymlinkNode(copied)) {
			options.onSymlinkCopyForTest?.(
				Object.freeze({
					sourceRootId: request.sourceRootId,
					sourcePath: request.sourcePath,
					targetRootId: request.targetRootId,
					targetPath: request.targetPath,
					payload: Object.freeze([...copied.payload.copy()]),
				}),
			);
		}
		publishPreparedCopy(prepared);
	};
	const moveObservation = (
		prepared: PreparedMockCopy,
		removedEntries: number,
	): BrowserMockWorkspaceMoveObservation =>
		Object.freeze({
			sourceRootId: prepared.request.sourceRootId,
			sourcePath: prepared.request.sourcePath,
			targetRootId: prepared.request.targetRootId,
			targetPath: prepared.request.targetPath,
			sourceKind: prepared.source.kind as "file" | "directory" | "symlink",
			removedEntries,
		});
	const joinedMovePath = (top: string, relativePath: string): string =>
		relativePath.length === 0 ? top : `${top}/${relativePath}`;
	interface MockMoveMutationJournal {
		sourceChanged: boolean;
		targetChanged: boolean;
	}
	const moveMutationsForTest = (
		prepared: PreparedMockCopy,
	): Readonly<{
		mutations: BrowserMockWorkspaceMoveMutationsForTest;
		journal: MockMoveMutationJournal;
	}> => {
		const journal: MockMoveMutationJournal = {
			sourceChanged: false,
			targetChanged: false,
		};
		const rewriteFile = (
			side: "source" | "target",
			rootId: string,
			top: string,
			relativePath: string,
			bytes: readonly number[],
		): void => {
			const node = resolveNode(rootId, joinedMovePath(top, relativePath));
			if (node.kind !== "file" || node.bytes.byteLength !== bytes.length) {
				throw new Error("Invalid browser mock workspace-move file rewrite.");
			}
			let changed = false;
			for (let index = 0; index < bytes.length; index += 1) {
				if (node.bytes[index] !== bytes[index]) {
					changed = true;
					break;
				}
			}
			node.bytes.set(bytes);
			if (changed) {
				journal[side === "source" ? "sourceChanged" : "targetChanged"] = true;
			}
		};
		const mutations = Object.freeze({
			rewriteSourceFile: (relativePath: string, bytes: readonly number[]) =>
				rewriteFile(
					"source",
					prepared.request.sourceRootId,
					prepared.request.sourcePath,
					relativePath,
					bytes,
				),
			rewriteTargetFile: (relativePath: string, bytes: readonly number[]) =>
				rewriteFile(
					"target",
					prepared.request.targetRootId,
					prepared.request.targetPath,
					relativePath,
					bytes,
				),
		});
		return Object.freeze({ mutations, journal });
	};
	const invokeMoveObserver = <Observation>(
		seam:
			| ((
					observation: Observation,
					mutations: BrowserMockWorkspaceMoveMutationsForTest,
			  ) => BrowserMockWorkspaceMoveSeamResult)
			| undefined,
		observation: Observation,
		mutations: BrowserMockWorkspaceMoveMutationsForTest,
		journal: MockMoveMutationJournal,
	): MockMoveObserverReason | undefined => {
		journal.sourceChanged = false;
		journal.targetChanged = false;
		if (seam === undefined) {
			return undefined;
		}
		try {
			const result = seam(observation, mutations);
			if (result === undefined) {
				return undefined;
			}
			return WORKSPACE_MOVE_OBSERVER_REASONS.has(result)
				? (result as MockMoveObserverReason)
				: "sourceUnverifiable";
		} catch {
			return "sourceUnverifiable";
		}
	};
	const moveDeleteObservation = (
		prepared: PreparedMockCopy,
		removedEntries: number,
		relativePath: string,
		kind: "file" | "directory" | "symlink",
	): BrowserMockWorkspaceMoveDeleteObservation =>
		Object.freeze({
			...moveObservation(prepared, removedEntries),
			relativePath,
			kind,
		});
	const moveDeleteFailed = (
		prepared: PreparedMockCopy,
		removedEntries: number,
		relativePath: string,
		kind: "file" | "directory" | "symlink",
	): boolean => {
		if (workspaceMoveSeams.deleteEntry === undefined) {
			return false;
		}
		try {
			workspaceMoveSeams.deleteEntry(
				moveDeleteObservation(prepared, removedEntries, relativePath, kind),
			);
			return false;
		} catch {
			return true;
		}
	};
	const incompleteMoveResult = (
		reason: WorkspaceMoveIncompleteReason,
		removedEntries: number,
	): WorkspaceMoveResult =>
		frozenWorkspaceMoveResult(
			removedEntries === 0
				? { status: "targetPublishedSourceRetained", reason }
				: {
						status: "targetPublishedSourcePartiallyDeleted",
						reason,
						removedEntries,
					},
		);
	const verifyMoveReceiptAt = (
		rootId: string,
		path: string,
		receipt: MockMoveReceipt,
		changedReason: "sourceChanged" | "targetChanged",
		unverifiableReason: "sourceUnverifiable" | "targetUnverifiable",
	): WorkspaceMoveIncompleteReason | undefined => {
		try {
			return matchesMockMoveReceipt(
				resolveNode(rootId, path),
				receipt,
				workspaceMoveSeams.receiptVisit,
			)
				? undefined
				: changedReason;
		} catch (error) {
			return mockMoveResolutionFailure(
				error,
				changedReason,
				unverifiableReason,
			);
		}
	};
	const verifyMoveTopLevelIdentity = (
		rootId: string,
		path: string,
		receipt: MockMoveReceipt,
		changedReason: "sourceChanged" | "targetChanged",
		unverifiableReason: "sourceUnverifiable" | "targetUnverifiable",
	): WorkspaceMoveIncompleteReason | undefined => {
		try {
			const node = resolveNode(rootId, path);
			return node === receipt.identity && node.kind === receipt.kind
				? undefined
				: changedReason;
		} catch (error) {
			return mockMoveResolutionFailure(
				error,
				changedReason,
				unverifiableReason,
			);
		}
	};
	const verifyMoveEndpoints = (
		prepared: PreparedMockCopy,
		sourceReceipt: MockMoveReceipt,
		targetReceipt: MockMoveReceipt,
	): WorkspaceMoveIncompleteReason | undefined => {
		let reason = verifyMoveReceiptAt(
			prepared.request.sourceRootId,
			prepared.request.sourcePath,
			sourceReceipt,
			"sourceChanged",
			"sourceUnverifiable",
		);
		if (reason !== undefined) {
			return reason;
		}
		reason = verifyMoveReceiptAt(
			prepared.request.targetRootId,
			prepared.request.targetPath,
			targetReceipt,
			"targetChanged",
			"targetUnverifiable",
		);
		return reason;
	};
	const adjudicateMoveObserver = (
		verifySource: () => WorkspaceMoveIncompleteReason | undefined,
		verifyTarget: () => WorkspaceMoveIncompleteReason | undefined,
		journal: MockMoveMutationJournal,
		observerReason: MockMoveObserverReason | undefined,
	): WorkspaceMoveIncompleteReason | undefined => {
		let reason = verifySource();
		if (reason !== undefined) {
			return reason;
		}
		if (journal.sourceChanged) {
			return "sourceChanged";
		}
		if (
			observerReason === "sourceChanged" ||
			observerReason === "sourceUnverifiable"
		) {
			return observerReason;
		}
		reason = verifyTarget();
		if (reason !== undefined) {
			return reason;
		}
		if (journal.targetChanged) {
			return "targetChanged";
		}
		return observerReason;
	};
	const adjudicateFullMoveObserver = (
		prepared: PreparedMockCopy,
		sourceReceipt: MockMoveReceipt,
		targetReceipt: MockMoveReceipt,
		journal: MockMoveMutationJournal,
		observerReason: MockMoveObserverReason | undefined,
	): WorkspaceMoveIncompleteReason | undefined =>
		adjudicateMoveObserver(
			() =>
				verifyMoveReceiptAt(
					prepared.request.sourceRootId,
					prepared.request.sourcePath,
					sourceReceipt,
					"sourceChanged",
					"sourceUnverifiable",
				),
			() =>
				verifyMoveReceiptAt(
					prepared.request.targetRootId,
					prepared.request.targetPath,
					targetReceipt,
					"targetChanged",
					"targetUnverifiable",
				),
			journal,
			observerReason,
		);
	const verifyMoveLocalReceiptAt = (
		rootId: string,
		path: string,
		receipt: MockMoveReceipt,
		directoryMustBeEmpty: boolean,
		changedReason: "sourceChanged" | "targetChanged",
		unverifiableReason: "sourceUnverifiable" | "targetUnverifiable",
	): WorkspaceMoveIncompleteReason | undefined => {
		try {
			const node = resolveNode(rootId, path);
			if (receipt.kind === "directory") {
				workspaceMoveSeams.receiptVisit?.();
				return node === receipt.identity &&
					node.kind === "directory" &&
					(!directoryMustBeEmpty || node.entries.size === 0)
					? undefined
					: changedReason;
			}
			return matchesMockMoveReceipt(
				node,
				receipt,
				workspaceMoveSeams.receiptVisit,
			)
				? undefined
				: changedReason;
		} catch (error) {
			return mockMoveResolutionFailure(
				error,
				changedReason,
				unverifiableReason,
			);
		}
	};
	const verifyRemovedSourceEntry = (
		prepared: PreparedMockCopy,
		sourceEntryPath: string,
		previousTarget: Readonly<{
			parent: MockDirectoryNode;
			name: string;
		}>,
	): WorkspaceMoveIncompleteReason | undefined => {
		try {
			const currentTarget = resolveCreateTarget(
				prepared.request.sourceRootId,
				sourceEntryPath,
			);
			return currentTarget.parent === previousTarget.parent &&
				currentTarget.name === previousTarget.name &&
				!currentTarget.parent.entries.has(currentTarget.name)
				? undefined
				: "sourceChanged";
		} catch (error) {
			return mockMoveResolutionFailure(
				error,
				"sourceChanged",
				"sourceUnverifiable",
			);
		}
	};
	const verifyDirectoryStepSource = (
		prepared: PreparedMockCopy,
		sourceReceipt: MockMoveDirectoryReceipt,
		entry: MockMoveReceiptEntry,
		sourceTarget: Readonly<{
			parent: MockDirectoryNode;
			name: string;
		}>,
		sourceState: "present" | "removed",
	): WorkspaceMoveIncompleteReason | undefined => {
		let reason = verifyMoveTopLevelIdentity(
			prepared.request.sourceRootId,
			prepared.request.sourcePath,
			sourceReceipt,
			"sourceChanged",
			"sourceUnverifiable",
		);
		if (reason !== undefined) {
			return reason;
		}
		const sourceEntryPath = joinedMovePath(
			prepared.request.sourcePath,
			entry.relativePath,
		);
		reason =
			sourceState === "present"
				? verifyMoveLocalReceiptAt(
						prepared.request.sourceRootId,
						sourceEntryPath,
						entry.receipt,
						true,
						"sourceChanged",
						"sourceUnverifiable",
					)
				: verifyRemovedSourceEntry(prepared, sourceEntryPath, sourceTarget);
		if (reason !== undefined) {
			return reason;
		}
		return undefined;
	};
	const verifyDirectoryStepTarget = (
		prepared: PreparedMockCopy,
		targetReceipt: MockMoveDirectoryReceipt,
		entry: MockMoveReceiptEntry,
		targetEntryReceipt: MockMoveReceipt,
	): WorkspaceMoveIncompleteReason | undefined => {
		const reason = verifyMoveTopLevelIdentity(
			prepared.request.targetRootId,
			prepared.request.targetPath,
			targetReceipt,
			"targetChanged",
			"targetUnverifiable",
		);
		if (reason !== undefined) {
			return reason;
		}
		return verifyMoveLocalReceiptAt(
			prepared.request.targetRootId,
			joinedMovePath(prepared.request.targetPath, entry.relativePath),
			targetEntryReceipt,
			false,
			"targetChanged",
			"targetUnverifiable",
		);
	};
	const verifyDirectoryStep = (
		prepared: PreparedMockCopy,
		sourceReceipt: MockMoveDirectoryReceipt,
		targetReceipt: MockMoveDirectoryReceipt,
		entry: MockMoveReceiptEntry,
		targetEntryReceipt: MockMoveReceipt,
		sourceTarget: Readonly<{
			parent: MockDirectoryNode;
			name: string;
		}>,
		sourceState: "present" | "removed",
	): WorkspaceMoveIncompleteReason | undefined => {
		const reason = verifyDirectoryStepSource(
			prepared,
			sourceReceipt,
			entry,
			sourceTarget,
			sourceState,
		);
		return reason === undefined
			? verifyDirectoryStepTarget(
					prepared,
					targetReceipt,
					entry,
					targetEntryReceipt,
				)
			: reason;
	};
	const verifyFinalDirectoryEndpoints = (
		prepared: PreparedMockCopy,
		sourceReceipt: MockMoveDirectoryReceipt,
		targetReceipt: MockMoveDirectoryReceipt,
	): WorkspaceMoveIncompleteReason | undefined => {
		try {
			const sourceRoot = resolveNode(
				prepared.request.sourceRootId,
				prepared.request.sourcePath,
			);
			workspaceMoveSeams.receiptVisit?.();
			if (
				sourceRoot !== sourceReceipt.identity ||
				sourceRoot.kind !== "directory" ||
				sourceRoot.entries.size !== 0
			) {
				return "sourceChanged";
			}
		} catch (error) {
			return mockMoveResolutionFailure(
				error,
				"sourceChanged",
				"sourceUnverifiable",
			);
		}
		return verifyMoveReceiptAt(
			prepared.request.targetRootId,
			prepared.request.targetPath,
			targetReceipt,
			"targetChanged",
			"targetUnverifiable",
		);
	};
	const moveEntry = (
		sourceRootId: string,
		sourcePath: string,
		targetRootId: string,
		targetPath: string,
	): WorkspaceMoveResult => {
		const prepared = prepareCopyEntry(
			frozenWorkspaceMoveRequest(
				sourceRootId,
				sourcePath,
				targetRootId,
				targetPath,
			),
		);
		const sourceReceipt = captureMockMoveReceipt(prepared.source);
		const targetReceipt = captureMockMoveReceipt(prepared.copied);
		const directoryDeletionPlan = prepareMockMoveDirectoryDeletionPlan(
			sourceReceipt,
			targetReceipt,
		);
		const { mutations, journal } = moveMutationsForTest(prepared);
		let removedEntries = 0;
		publishPreparedCopy(prepared);

		try {
			let observerReason = invokeMoveObserver(
				workspaceMoveSeams.afterPublication,
				moveObservation(prepared, 0),
				mutations,
				journal,
			);
			let reason = adjudicateFullMoveObserver(
				prepared,
				sourceReceipt,
				targetReceipt,
				journal,
				observerReason,
			);
			if (reason !== undefined) {
				return incompleteMoveResult(reason, 0);
			}
			observerReason = invokeMoveObserver(
				workspaceMoveSeams.beforeDelete,
				moveObservation(prepared, 0),
				mutations,
				journal,
			);
			reason = adjudicateFullMoveObserver(
				prepared,
				sourceReceipt,
				targetReceipt,
				journal,
				observerReason,
			);
			if (reason !== undefined) {
				return incompleteMoveResult(reason, 0);
			}

			if (sourceReceipt.kind !== "directory") {
				reason = verifyMoveEndpoints(prepared, sourceReceipt, targetReceipt);
				if (reason !== undefined) {
					return incompleteMoveResult(reason, 0);
				}
				let sourceTarget: Readonly<{
					parent: MockDirectoryNode;
					name: string;
				}>;
				try {
					sourceTarget = resolveCreateTarget(
						prepared.request.sourceRootId,
						prepared.request.sourcePath,
					);
				} catch (error) {
					return incompleteMoveResult(
						mockMoveResolutionFailure(
							error,
							"sourceChanged",
							"sourceUnverifiable",
						),
						0,
					);
				}
				const current = sourceTarget.parent.entries.get(sourceTarget.name);
				if (current !== sourceReceipt.identity) {
					return incompleteMoveResult("sourceChanged", 0);
				}
				const deleteFailed = moveDeleteFailed(
					prepared,
					0,
					"",
					sourceReceipt.kind,
				);
				reason = verifyMoveEndpoints(prepared, sourceReceipt, targetReceipt);
				if (reason !== undefined) {
					return incompleteMoveResult(reason, 0);
				}
				if (deleteFailed) {
					return incompleteMoveResult("deleteFailed", 0);
				}
				if (!sourceTarget.parent.entries.delete(sourceTarget.name)) {
					return incompleteMoveResult("deleteFailed", 0);
				}
				touchDeleteNode(sourceTarget.parent);
				unlinkDeleteNode(sourceReceipt.identity);
				return frozenWorkspaceMoveResult({ status: "moved" });
			}

			if (directoryDeletionPlan === undefined) {
				return incompleteMoveResult("targetChanged", 0);
			}
			const {
				targetReceipt: targetDirectoryReceipt,
				leaves,
				directories,
				targetReceipts,
			} = directoryDeletionPlan;
			for (const entry of [...leaves, ...directories]) {
				const sourceEntryPath = joinedMovePath(
					prepared.request.sourcePath,
					entry.relativePath,
				);
				const targetEntryReceipt = targetReceipts.get(entry.relativePath);
				if (targetEntryReceipt === undefined) {
					return incompleteMoveResult("targetChanged", removedEntries);
				}
				let sourceTarget: Readonly<{
					parent: MockDirectoryNode;
					name: string;
				}>;
				try {
					sourceTarget = resolveCreateTarget(
						prepared.request.sourceRootId,
						sourceEntryPath,
					);
				} catch (error) {
					return incompleteMoveResult(
						mockMoveResolutionFailure(
							error,
							"sourceChanged",
							"sourceUnverifiable",
						),
						removedEntries,
					);
				}
				reason = verifyDirectoryStep(
					prepared,
					sourceReceipt,
					targetDirectoryReceipt,
					entry,
					targetEntryReceipt,
					sourceTarget,
					"present",
				);
				if (reason !== undefined) {
					return incompleteMoveResult(reason, removedEntries);
				}
				if (
					sourceTarget.parent.entries.get(sourceTarget.name) !==
					entry.receipt.identity
				) {
					return incompleteMoveResult("sourceChanged", removedEntries);
				}
				if (workspaceMoveSeams.deleteEntry !== undefined) {
					const deleteFailed = moveDeleteFailed(
						prepared,
						removedEntries,
						entry.relativePath,
						entry.receipt.kind,
					);
					reason = verifyDirectoryStep(
						prepared,
						sourceReceipt,
						targetDirectoryReceipt,
						entry,
						targetEntryReceipt,
						sourceTarget,
						"present",
					);
					if (reason !== undefined) {
						return incompleteMoveResult(reason, removedEntries);
					}
					if (deleteFailed) {
						return incompleteMoveResult("deleteFailed", removedEntries);
					}
				}
				if (!sourceTarget.parent.entries.delete(sourceTarget.name)) {
					return incompleteMoveResult("deleteFailed", removedEntries);
				}
				touchDeleteNode(sourceTarget.parent);
				unlinkDeleteNode(entry.receipt.identity);
				removedEntries += 1;
				if (workspaceMoveSeams.afterDeleteEntry !== undefined) {
					const observation = Object.freeze({
						...moveObservation(prepared, removedEntries),
						relativePath: entry.relativePath,
						kind: entry.receipt.kind,
					}) satisfies BrowserMockWorkspaceMoveDeletedEntryObservation;
					observerReason = invokeMoveObserver(
						workspaceMoveSeams.afterDeleteEntry,
						observation,
						mutations,
						journal,
					);
					reason = adjudicateMoveObserver(
						() =>
							verifyDirectoryStepSource(
								prepared,
								sourceReceipt,
								entry,
								sourceTarget,
								"removed",
							),
						() =>
							verifyDirectoryStepTarget(
								prepared,
								targetDirectoryReceipt,
								entry,
								targetEntryReceipt,
							),
						journal,
						observerReason,
					);
					if (reason !== undefined) {
						return incompleteMoveResult(reason, removedEntries);
					}
				}
			}

			reason = verifyFinalDirectoryEndpoints(
				prepared,
				sourceReceipt,
				targetDirectoryReceipt,
			);
			if (reason !== undefined) {
				return incompleteMoveResult(reason, removedEntries);
			}
			let sourceTarget: Readonly<{
				parent: MockDirectoryNode;
				name: string;
			}>;
			try {
				sourceTarget = resolveCreateTarget(
					prepared.request.sourceRootId,
					prepared.request.sourcePath,
				);
			} catch (error) {
				return incompleteMoveResult(
					mockMoveResolutionFailure(
						error,
						"sourceChanged",
						"sourceUnverifiable",
					),
					removedEntries,
				);
			}
			if (
				sourceTarget.parent.entries.get(sourceTarget.name) !==
				sourceReceipt.identity
			) {
				return incompleteMoveResult("sourceChanged", removedEntries);
			}
			if (workspaceMoveSeams.deleteEntry !== undefined) {
				const deleteFailed = moveDeleteFailed(
					prepared,
					removedEntries,
					"",
					"directory",
				);
				reason = verifyFinalDirectoryEndpoints(
					prepared,
					sourceReceipt,
					targetDirectoryReceipt,
				);
				if (reason !== undefined) {
					return incompleteMoveResult(reason, removedEntries);
				}
				if (deleteFailed) {
					return incompleteMoveResult("deleteFailed", removedEntries);
				}
			}
			if (!sourceTarget.parent.entries.delete(sourceTarget.name)) {
				return incompleteMoveResult("deleteFailed", removedEntries);
			}
			touchDeleteNode(sourceTarget.parent);
			unlinkDeleteNode(sourceReceipt.identity);
			return frozenWorkspaceMoveResult({ status: "moved" });
		} catch {
			return incompleteMoveResult("sourceUnverifiable", removedEntries);
		}
	};
	const deleteDeadline = (now: number): number => {
		const deadline = now + WORKSPACE_DELETE_IDLE_TTL_MS;
		if (!Number.isSafeInteger(deadline)) {
			throw workspaceDeletePlanInvalid();
		}
		return deadline;
	};
	const trashDeadline = (now: number): number => {
		const deadline = now + WORKSPACE_DELETE_IDLE_TTL_MS;
		if (!Number.isSafeInteger(deadline)) {
			throw workspaceTrashPlanInvalid();
		}
		return deadline;
	};
	const deleteObservation = (
		confirmationId: string,
		phase: BrowserMockWorkspaceDeleteObservation["phase"],
		removedEntries: number,
		details: Readonly<{
			entryIndex?: number;
			kind?: WorkspaceDeleteEntryKind;
			descendantEntries?: number;
			isRoot?: boolean;
		}> = {},
	): BrowserMockWorkspaceDeleteObservation =>
		Object.freeze({
			confirmationId,
			phase,
			removedEntries,
			...(details.entryIndex === undefined
				? {}
				: { entryIndex: details.entryIndex }),
			...(details.kind === undefined ? {} : { kind: details.kind }),
			...(details.descendantEntries === undefined
				? {}
				: { descendantEntries: details.descendantEntries }),
			...(details.isRoot === undefined ? {} : { isRoot: details.isRoot }),
		});
	const invokeDeleteObserver = (
		seam:
			| ((
					observation: BrowserMockWorkspaceDeleteObservation,
					mutations: BrowserMockWorkspaceDeleteMutationsForTest,
			  ) => void)
			| undefined,
		observation: BrowserMockWorkspaceDeleteObservation,
	): Readonly<{ threw: boolean; touchedNodes: ReadonlySet<MockNode> }> => {
		deleteObserverTouchedNodes.clear();
		if (seam === undefined) {
			return Object.freeze({
				threw: false,
				touchedNodes: new Set<MockNode>(),
			});
		}
		try {
			seam(observation, deleteMutations);
			return Object.freeze({
				threw: false,
				touchedNodes: new Set(deleteObserverTouchedNodes),
			});
		} catch {
			return Object.freeze({
				threw: true,
				touchedNodes: new Set(deleteObserverTouchedNodes),
			});
		}
	};
	const prepareDeleteBatch = (
		entriesInput: readonly WorkspaceDeleteEntryRequest[],
	): WorkspaceDeleteBatchPlan => {
		const request = frozenWorkspacePrepareDeleteRequest(entriesInput);
		if (
			request.entries.length < 1 ||
			request.entries.length > MAX_DELETE_BATCH_ENTRIES
		) {
			throw workspaceDeletePlanInvalid();
		}
		const now = deleteNow();
		expireDeleteBatch(now);
		if (activeDeleteBatch !== undefined || activeTrashBatch !== undefined) {
			throw workspaceDeleteConflict();
		}

		const budget: DeleteCaptureBudget = {
			descendants: 0,
			namePayloadBytes: 0,
			symlinkPayloadBytes: 0,
		};
		const seenTopIdentities = new Set<MockNode>();
		const tops = request.entries.map((entry): MockDeleteTopReceipt => {
			const target = resolveCreateTarget(entry.rootId, entry.relativePath);
			const node = target.parent.entries.get(target.name);
			if (node === undefined) {
				throw entryNotFound();
			}
			if (seenTopIdentities.has(node)) {
				throw workspaceDeleteConflict();
			}
			seenTopIdentities.add(node);
			if (
				node.kind === "directory" &&
				!entry.recursive &&
				node.entries.size > 0
			) {
				throw directoryNotEmpty();
			}
			const beforeDescendants = budget.descendants;
			const receipt = captureDeleteReceipt(node, "", 0, budget);
			return Object.freeze({
				request: entry,
				parentIdentity: target.parent,
				name: target.name,
				receipt,
				receiptIdentities: collectDeleteReceiptIdentities(receipt),
				descendantEntries: budget.descendants - beforeDescendants,
			});
		});
		const batchReceiptIdentities = new Set<MockNode>();
		for (const top of tops) {
			for (const identity of top.receiptIdentities) {
				if (batchReceiptIdentities.has(identity)) {
					throw workspaceDeleteConflict();
				}
				batchReceiptIdentities.add(identity);
			}
		}
		const confirmationId = nextDeleteId();
		const batchEntries = tops.map((top) =>
			Object.freeze({ entryId: nextDeleteId(), top }),
		);
		const plan = frozenWorkspaceDeleteBatchPlan(
			{
				confirmationId,
				entries: batchEntries.map(({ entryId, top }) => ({
					entryId,
					kind: top.receipt.kind,
					descendantEntries: top.descendantEntries,
				})),
			},
			request,
		);
		const observer = invokeDeleteObserver(
			workspaceDeleteSeams.prepared,
			deleteObservation(confirmationId, "prepared", 0),
		);
		if (tops.some((top) => !matchesDeleteTop(top))) {
			throw workspaceDeleteBatchChanged();
		}
		if (observer.threw) {
			throw workspaceDeleteBatchUnverifiable();
		}
		const completedNow = deleteNow();
		if (completedNow < now) {
			throw workspaceDeletePlanInvalid();
		}
		activeDeleteBatch = {
			confirmationId,
			revision,
			entries: Object.freeze(batchEntries),
			phase: "prepared",
			nextIndex: 0,
			deadline: deleteDeadline(completedNow),
			inFlight: false,
		};
		return plan;
	};
	const matchingDeleteBatch = (
		confirmationId: string,
		phase?: MockDeleteBatch["phase"],
	): MockDeleteBatch => {
		const now = deleteNow();
		expireDeleteBatch(now);
		const batch = activeDeleteBatch;
		if (
			batch === undefined ||
			batch.confirmationId !== confirmationId ||
			(phase !== undefined && batch.phase !== phase) ||
			batch.revision !== revision ||
			batch.inFlight
		) {
			throw workspaceDeletePlanInvalid();
		}
		return batch;
	};
	const cancelDeleteBatch = (confirmationIdInput: string): void => {
		const { confirmationId } =
			frozenWorkspaceDeleteBatchRequest(confirmationIdInput);
		matchingDeleteBatch(confirmationId);
		activeDeleteBatch = undefined;
	};
	const beginDeleteBatch = (confirmationIdInput: string): void => {
		const { confirmationId } =
			frozenWorkspaceDeleteBatchRequest(confirmationIdInput);
		const batch = matchingDeleteBatch(confirmationId, "prepared");
		const observer = invokeDeleteObserver(
			workspaceDeleteSeams.begin,
			deleteObservation(confirmationId, "begin", 0),
		);
		if (batch.entries.some(({ top }) => !matchesDeleteTop(top))) {
			activeDeleteBatch = undefined;
			throw workspaceDeleteBatchChanged();
		}
		if (observer.threw) {
			activeDeleteBatch = undefined;
			throw workspaceDeleteBatchUnverifiable();
		}
		batch.phase = "executing";
		batch.deadline = deleteDeadline(deleteNow());
	};
	const incompleteDeleteResult = (
		reason: WorkspaceDeleteIncompleteReason,
		removedEntries: number,
	): WorkspaceDeleteResult =>
		frozenWorkspaceDeleteResult(
			removedEntries === 0
				? { status: "entryRetained", reason }
				: {
						status: "entryPartiallyDeleted",
						reason,
						removedEntries,
					},
		);
	const verifiedDeleteEntry = (
		batch: MockDeleteBatch,
		entryIndex: number,
		entry: MockDeleteBatchEntry,
	): WorkspaceDeleteResult => {
		const top = entry.top;
		const expectedMetadata = new Map<MockNode, MockDeleteMetadataSnapshot>();
		collectDeleteExpectedMetadata(top.receipt, expectedMetadata);
		const journal: MockDeleteJournal = {
			removedPaths: new Set<string>(),
			expectedMetadata,
			removedChildCounts: new Map<MockDirectoryNode, number>(),
		};
		let removedEntries = 0;
		if (!matchesDeleteTop(top)) {
			return incompleteDeleteResult("entryChanged", 0);
		}
		const observerTouchedReceipt = (
			observation: Readonly<{ touchedNodes: ReadonlySet<MockNode> }>,
		): boolean => {
			for (const node of observation.touchedNodes) {
				if (top.receiptIdentities.has(node)) {
					return true;
				}
			}
			return false;
		};
		const matchesLocalReceipt = (
			node: MockNode,
			receipt: MockDeleteReceipt,
			directoryMustBeEmpty: boolean,
		): boolean => {
			workspaceDeleteSeams.receiptVisit?.();
			if (node !== receipt.identity || node.kind !== receipt.kind) {
				return false;
			}
			const expected = journal.expectedMetadata.get(node) ?? receipt.metadata;
			if (!metadataEqual(metadataFor(node), expected)) {
				return false;
			}
			if (receipt.kind === "file") {
				return node.kind === "file" && node.size === receipt.size;
			}
			if (receipt.kind === "symlink") {
				return (
					isMockSymlinkNode(node) &&
					mockBytesEqual(node.payload.copy(), receipt.payload.copy())
				);
			}
			return (
				node.kind === "directory" &&
				(!directoryMustBeEmpty || node.entries.size === 0)
			);
		};
		const matchesTopHeader = (): boolean => {
			const current = top.parentIdentity.entries.get(top.name);
			return (
				current !== undefined &&
				matchesLocalReceipt(current, top.receipt, false)
			);
		};
		const flattened = flattenDeleteReceipt(top.receipt);
		const descendants = [
			...flattened
				.filter(({ receipt }) => receipt.kind !== "directory")
				.sort(
					(left, right) =>
						right.depth - left.depth ||
						compareWorkspaceEntryNames(left.relativePath, right.relativePath),
				),
			...flattened
				.filter(({ receipt }) => receipt.kind === "directory")
				.sort(
					(left, right) =>
						right.depth - left.depth ||
						compareWorkspaceEntryNames(left.relativePath, right.relativePath),
				),
		];
		const removeOne = (
			entryReceipt: MockDeleteReceiptEntry | undefined,
			receipt: MockDeleteReceipt,
			isRoot: boolean,
		): WorkspaceDeleteResult | undefined => {
			const observation = deleteObservation(
				batch.confirmationId,
				"beforeRemove",
				removedEntries,
				{
					entryIndex,
					kind: receipt.kind,
					descendantEntries: top.descendantEntries,
					isRoot,
				},
			);
			const observer = invokeDeleteObserver(
				workspaceDeleteSeams.beforeRemove,
				observation,
			);
			if (observerTouchedReceipt(observer) || !matchesTopHeader()) {
				return incompleteDeleteResult("entryChanged", removedEntries);
			}
			if (observer.threw) {
				return incompleteDeleteResult("entryUnverifiable", removedEntries);
			}
			const target = isRoot
				? Object.freeze({ parent: top.parentIdentity, name: top.name })
				: Object.freeze({
						parent: entryReceipt!.parentIdentity,
						name: entryReceipt!.name,
					});
			if (!isRoot) {
				const expectedParent = journal.expectedMetadata.get(target.parent);
				const removedChildren =
					journal.removedChildCounts.get(target.parent) ?? 0;
				if (
					expectedParent === undefined ||
					!metadataEqual(metadataFor(target.parent), expectedParent) ||
					target.parent.entries.size !==
						entryReceipt!.parentEntryCount - removedChildren
				) {
					return incompleteDeleteResult("entryChanged", removedEntries);
				}
			}
			const current = target.parent.entries.get(target.name);
			if (
				current === undefined ||
				!matchesLocalReceipt(current, receipt, true)
			) {
				return incompleteDeleteResult("entryChanged", removedEntries);
			}
			let removeFailed = false;
			try {
				workspaceDeleteSeams.remove?.(observation);
			} catch {
				removeFailed = true;
			}
			if (!matchesTopHeader()) {
				return incompleteDeleteResult("entryChanged", removedEntries);
			}
			if (removeFailed) {
				return incompleteDeleteResult("deleteFailed", removedEntries);
			}
			if (!target.parent.entries.delete(target.name)) {
				return incompleteDeleteResult("deleteFailed", removedEntries);
			}
			touchDeleteNode(target.parent);
			unlinkDeleteNode(current);
			if (isRoot) {
				return frozenWorkspaceDeleteResult({ status: "deleted" });
			}
			journal.removedPaths.add(entryReceipt!.relativePath);
			journal.removedChildCounts.set(
				target.parent,
				(journal.removedChildCounts.get(target.parent) ?? 0) + 1,
			);
			journal.expectedMetadata.set(
				target.parent,
				metadataSnapshot(target.parent),
			);
			journal.expectedMetadata.set(current, metadataSnapshot(current));
			removedEntries += 1;
			const afterObservation = deleteObservation(
				batch.confirmationId,
				"afterRemove",
				removedEntries,
				{
					entryIndex,
					kind: receipt.kind,
					descendantEntries: top.descendantEntries,
					isRoot: false,
				},
			);
			const afterObserver = invokeDeleteObserver(
				workspaceDeleteSeams.afterRemove,
				afterObservation,
			);
			if (observerTouchedReceipt(afterObserver) || !matchesTopHeader()) {
				return incompleteDeleteResult("entryChanged", removedEntries);
			}
			return afterObserver.threw
				? incompleteDeleteResult("entryUnverifiable", removedEntries)
				: undefined;
		};

		for (const descendant of descendants) {
			const result = removeOne(descendant, descendant.receipt, false);
			if (result !== undefined) {
				return result;
			}
		}
		return (
			removeOne(undefined, top.receipt, true) ??
			incompleteDeleteResult("entryUnverifiable", removedEntries)
		);
	};
	const commitDeleteEntry = (
		confirmationIdInput: string,
		entryIdInput: string,
		rootIdInput: string,
		relativePathInput: string,
		recursiveInput: boolean,
	): WorkspaceDeleteResult => {
		const request: WorkspaceCommitDeleteEntryRequest =
			frozenWorkspaceCommitDeleteEntryRequest(
				confirmationIdInput,
				entryIdInput,
				rootIdInput,
				relativePathInput,
				recursiveInput,
			);
		const batch = matchingDeleteBatch(request.confirmationId, "executing");
		const entry = batch.entries[batch.nextIndex];
		if (
			entry === undefined ||
			entry.entryId !== request.entryId ||
			entry.top.request.rootId !== request.rootId ||
			entry.top.request.relativePath !== request.relativePath ||
			entry.top.request.recursive !== request.recursive
		) {
			activeDeleteBatch = undefined;
			throw workspaceDeletePlanInvalid();
		}
		batch.inFlight = true;
		const result = verifiedDeleteEntry(batch, batch.nextIndex, entry);
		batch.inFlight = false;
		if (result.status !== "deleted") {
			activeDeleteBatch = undefined;
			return result;
		}
		batch.nextIndex += 1;
		if (batch.nextIndex >= batch.entries.length) {
			activeDeleteBatch = undefined;
			return result;
		}
		try {
			batch.deadline = deleteDeadline(deleteNow());
		} catch {
			activeDeleteBatch = undefined;
		}
		return result;
	};
	const prepareTrashBatch = (
		entriesInput: readonly WorkspaceTrashEntryRequest[],
	): WorkspaceTrashBatchPlan => {
		const request = frozenWorkspacePrepareTrashRequest(entriesInput);
		if (
			request.entries.length < 1 ||
			request.entries.length > MAX_TRASH_BATCH_ENTRIES
		) {
			throw workspaceTrashPlanInvalid();
		}
		const now = trashNow();
		expireDeleteBatch(now);
		if (activeDeleteBatch !== undefined || activeTrashBatch !== undefined) {
			throw workspaceTrashConflict();
		}

		const seenTopIdentities = new Set<MockNode>();
		const tops = request.entries.map((entry): MockTrashTopReceipt => {
			const target = resolveCreateTarget(entry.rootId, entry.relativePath);
			const node = target.parent.entries.get(target.name);
			if (node === undefined) {
				throw entryNotFound();
			}
			if (seenTopIdentities.has(node)) {
				throw workspaceTrashConflict();
			}
			seenTopIdentities.add(node);
			return Object.freeze({
				request: entry,
				parentIdentity: target.parent,
				name: target.name,
				receipt: captureTrashReceipt(node),
			});
		});
		if (tops.some((top) => !matchesTrashTop(top))) {
			throw workspaceTrashBatchChanged();
		}
		const confirmationId = nextDeleteId();
		const entries = tops.map((top) =>
			Object.freeze({ entryId: nextDeleteId(), top }),
		);
		const plan = frozenWorkspaceTrashBatchPlan(
			{
				confirmationId,
				entries: entries.map(({ entryId, top }) => ({
					entryId,
					kind: top.receipt.kind,
				})),
			},
			request,
		);
		const completedNow = trashNow();
		if (completedNow < now) {
			throw workspaceTrashPlanInvalid();
		}
		activeTrashBatch = {
			confirmationId,
			revision,
			entries: Object.freeze(entries),
			phase: "prepared",
			nextIndex: 0,
			deadline: trashDeadline(completedNow),
			inFlight: false,
		};
		return plan;
	};
	const matchingTrashBatch = (
		confirmationId: string,
		phase?: MockTrashBatch["phase"],
	): MockTrashBatch => {
		const now = trashNow();
		expireDeleteBatch(now);
		const batch = activeTrashBatch;
		if (
			batch === undefined ||
			batch.confirmationId !== confirmationId ||
			(phase !== undefined && batch.phase !== phase) ||
			batch.revision !== revision ||
			batch.inFlight
		) {
			throw workspaceTrashPlanInvalid();
		}
		return batch;
	};
	const cancelTrashBatch = (confirmationIdInput: string): void => {
		const { confirmationId } =
			frozenWorkspaceTrashBatchRequest(confirmationIdInput);
		matchingTrashBatch(confirmationId);
		activeTrashBatch = undefined;
	};
	const beginTrashBatch = (confirmationIdInput: string): void => {
		const { confirmationId } =
			frozenWorkspaceTrashBatchRequest(confirmationIdInput);
		const batch = matchingTrashBatch(confirmationId, "prepared");
		if (batch.entries.some(({ top }) => !matchesTrashTop(top))) {
			activeTrashBatch = undefined;
			throw workspaceTrashBatchChanged();
		}
		batch.phase = "executing";
		batch.deadline = trashDeadline(trashNow());
	};
	const retainedTrashResult = (
		reason: "entryChanged" | "entryUnverifiable" | "trashFailed",
	): WorkspaceTrashResult =>
		frozenWorkspaceTrashResult({ status: "entryRetained", reason });
	const commitTrashEntry = (
		confirmationIdInput: string,
		entryIdInput: string,
		rootIdInput: string,
		relativePathInput: string,
	): WorkspaceTrashResult => {
		const request: WorkspaceCommitTrashEntryRequest =
			frozenWorkspaceCommitTrashEntryRequest(
				confirmationIdInput,
				entryIdInput,
				rootIdInput,
				relativePathInput,
			);
		const batch = matchingTrashBatch(request.confirmationId, "executing");
		const entry = batch.entries[batch.nextIndex];
		if (
			entry === undefined ||
			entry.entryId !== request.entryId ||
			entry.top.request.rootId !== request.rootId ||
			entry.top.request.relativePath !== request.relativePath
		) {
			activeTrashBatch = undefined;
			throw workspaceTrashPlanInvalid();
		}
		batch.inFlight = true;
		if (!matchesTrashTop(entry.top)) {
			batch.inFlight = false;
			activeTrashBatch = undefined;
			return retainedTrashResult("entryChanged");
		}
		const scripted =
			scriptedWorkspaceTrashResults.shift() ??
			frozenWorkspaceTrashResult({ status: "trashed" });
		if (scripted.status !== "trashed") {
			batch.inFlight = false;
			activeTrashBatch = undefined;
			return scripted;
		}
		const target = resolveCreateTarget(
			entry.top.request.rootId,
			entry.top.request.relativePath,
		);
		const node = target.parent.entries.get(target.name);
		if (
			target.parent !== entry.top.parentIdentity ||
			target.name !== entry.top.name ||
			node === undefined ||
			!matchesTrashReceipt(node, entry.top.receipt) ||
			!target.parent.entries.delete(target.name)
		) {
			batch.inFlight = false;
			activeTrashBatch = undefined;
			return retainedTrashResult("trashFailed");
		}
		touchDeleteNode(target.parent);
		batch.inFlight = false;
		batch.nextIndex += 1;
		if (batch.nextIndex >= batch.entries.length) {
			activeTrashBatch = undefined;
			return scripted;
		}
		try {
			batch.deadline = trashDeadline(trashNow());
		} catch {
			activeTrashBatch = undefined;
		}
		return scripted;
	};

	const searchWorkspaceFiles = (
		request: Readonly<{
			roots: readonly string[];
			filePattern: string;
			excludeGlobs: readonly string[];
			maxResults: number;
		}>,
	): WorkspaceSearchFilesResult => {
		const excludeMatchers = request.excludeGlobs.map(compileMockExcludeGlob);
		const patternLower = request.filePattern.toLowerCase();
		const entries: { rootId: string; path: string }[] = [];
		let limitHit = false;
		let visited = 0;

		interface SearchFrame {
			readonly directory: MockDirectoryNode;
			readonly wire: string;
			readonly depth: number;
			readonly gitignoreChain: readonly MockGitignoreLayer[];
			readonly names: readonly string[];
			nextIndex: number;
		}

		// Mirrors WorkspaceService::search_files: every named root is leased
		// (authorization-checked) up front, so an unauthorized root fails the
		// whole request closed rather than being silently skipped.
		for (const rootId of request.roots) {
			if (!roots.has(rootId)) {
				throw rootNotAuthorized();
			}
		}

		rootsLoop: for (const rootId of request.roots) {
			const root = trees.get(rootId);
			if (root === undefined || root.kind !== "directory") {
				continue;
			}
			const frames: SearchFrame[] = [
				{
					directory: root,
					wire: "",
					depth: 0,
					gitignoreChain: [mockGitignoreLayerFor(root, "")],
					names: [...root.entries.keys()].sort(compareWorkspaceEntryNames),
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
				if (visited > MAX_MOCK_SEARCH_TREE_ENTRIES) {
					limitHit = true;
					break rootsLoop;
				}
				const child = frame.directory.entries.get(name);
				if (child === undefined) {
					continue;
				}
				const wire = frame.wire.length === 0 ? name : `${frame.wire}/${name}`;
				const isDir = child.kind === "directory";
				const excluded =
					excludeMatchers.some((matches) => matches(wire)) ||
					mockPathIsGitignored(frame.gitignoreChain, wire, isDir);

				if (child.kind === "directory") {
					if (excluded) {
						continue;
					}
					const depth = frame.depth + 1;
					if (depth > MAX_MOCK_SEARCH_TREE_DEPTH) {
						limitHit = true;
						continue;
					}
					frames.push({
						directory: child,
						wire,
						depth,
						gitignoreChain: [
							...frame.gitignoreChain,
							mockGitignoreLayerFor(child, wire),
						],
						names: [...child.entries.keys()].sort(compareWorkspaceEntryNames),
						nextIndex: 0,
					});
				} else if (child.kind === "file") {
					if (excluded) {
						continue;
					}
					if (
						patternLower.length > 0 &&
						!isMockSubsequence(patternLower, wire.toLowerCase())
					) {
						continue;
					}
					entries.push(Object.freeze({ rootId, path: wire }));
					if (entries.length >= request.maxResults) {
						limitHit = true;
						break rootsLoop;
					}
				}
				// Symlinks and other node kinds are never followed or
				// reported, matching Rust's traversal policy.
			}
		}

		return frozenWorkspaceSearchFilesResult(entries, limitHit);
	};

	// --- Streaming text search (F040 S3) ------------------------------------

	const MAX_MOCK_TEXT_SEARCH_MATCHES =
		options.textSearchMaxMatchesForTest ?? 20_000;
	const MOCK_TEXT_SEARCH_BATCHES_PER_POLL =
		options.textSearchBatchesPerPollForTest ?? 1;
	const lenientTextDecoder = new TextDecoder("utf-8", { fatal: false });
	const issuedTextSearchIds = new Set<string>();
	const nextTextSearchId = (): string => {
		for (let attempt = 0; attempt < 16; attempt += 1) {
			const bytes = new Uint8Array(16);
			globalThis.crypto.getRandomValues(bytes);
			bytes[6] = (bytes[6]! & 0x0f) | 0x40;
			bytes[8] = (bytes[8]! & 0x3f) | 0x80;
			const hex = [...bytes]
				.map((value) => value.toString(16).padStart(2, "0"))
				.join("");
			const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
				12,
				16,
			)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
			if (!issuedTextSearchIds.has(id)) {
				issuedTextSearchIds.add(id);
				return id;
			}
		}
		throw new Error("Browser mock text-search id generation failed.");
	};

	interface MockTextSearchBatch {
		readonly rootId: string;
		readonly path: string;
		readonly matches: readonly {
			readonly line: number;
			readonly column: number;
			readonly length: number;
			readonly previewText: string;
			readonly absoluteColumn: number;
		}[];
	}

	interface MockTextSearch {
		readonly searchId: string;
		pending: MockTextSearchBatch[];
		deliveredCursor: number;
		readonly limitHit: boolean;
		readonly skippedBinary: number;
		readonly skippedOversize: number;
	}

	// --- Terminal + execution trust (F070 "IPC 改造": render-state frames) ---

	/** Approximates the conventional Unix "128 + signal" shell reporting for
	 * a killed process (SIGKILL = 9) — an approximation for mock purposes
	 * only, not a guarantee of byte-for-byte parity with `portable_pty`'s
	 * real exit-code encoding for a killed child. */
	const MOCK_TERMINAL_KILLED_EXIT_CODE = 137;
	/** Fixed neutral color scheme every mock frame reports — this mock does
	 * not model SGR styling at all (see
	 * `BrowserMockTerminalSessionController`'s doc comment), so every cell
	 * is unstyled and every frame's `colors` are these same two constants. */
	const MOCK_TERMINAL_BACKGROUND: TerminalRgb = Object.freeze({
		r: 0,
		g: 0,
		b: 0,
	});
	const MOCK_TERMINAL_FOREGROUND: TerminalRgb = Object.freeze({
		r: 229,
		g: 229,
		b: 229,
	});
	const MOCK_TERMINAL_DEFAULT_STYLE: TerminalStyle = Object.freeze({
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

	let terminalTrusted = options.terminalTrustedForTest ?? false;
	const terminalDataListeners = new Set<(event: TerminalDataEvent) => void>();
	const terminalExitListeners = new Set<(event: TerminalExitEvent) => void>();

	/** `F100` S1 mock confirmation state — a workspace-independent set of
	 * confirmed `(command, args, transport)` keys, mirroring `terminalTrusted`'s
	 * own "gated on `roots.size === 0`, otherwise a plain in-memory flag" shape
	 * (this mock, unlike real Rust, has no per-workspace-identity scoping —
	 * every mocked window shares one fixture-global fake workspace already,
	 * matching `terminalTrusted`'s identical simplification). */
	const debugAdapterConfirmations = new Set<string>();
	function debugAdapterConfirmationKey(
		descriptor: DebugAdapterConfirmationSubject,
	): string {
		return JSON.stringify([
			descriptor.command,
			descriptor.args,
			descriptor.transport,
		]);
	}
	function debugAdapterConfirmationUnavailable(): CommandError {
		return commandError(
			"DEBUG_ADAPTER_CONFIRMATION_UNAVAILABLE",
			"The debug adapter confirmation store is not available for this window.",
		);
	}

	// --- `F100` S3: real session-lifecycle + interactive debugging mock. ---

	function debugAdapterNotConfirmed(): CommandError {
		return commandError(
			"DEBUG_ADAPTER_NOT_CONFIRMED",
			"This exact adapter command has not been confirmed for this workspace yet.",
		);
	}

	function debugSessionNotFound(): CommandError {
		return commandError(
			"DEBUG_SESSION_NOT_FOUND",
			"The requested debug session does not exist for this window.",
		);
	}

	// `F210` S6 — the two spawn-then-connect failure codes
	// `src-tauri/src/debug/mod.rs`'s `debug_adapter_tcp_companion_exited`/
	// `debug_adapter_tcp_companion_connect_timed_out` report; see
	// `BrowserMockDebugFixtureForTest.tcpSpawnOutcomeForTest`'s own doc
	// comment for why this mock reports the identical code/message shape
	// rather than re-simulating the real spawn/retry-connect timing.
	function debugAdapterTcpCompanionExited(): CommandError {
		return commandError(
			"DEBUG_ADAPTER_TCP_COMPANION_EXITED",
			"The spawned debug adapter process exited before Plain could connect to its TCP listener.",
		);
	}

	function debugAdapterTcpCompanionConnectTimedOut(): CommandError {
		return commandError(
			"DEBUG_ADAPTER_TCP_COMPANION_CONNECT_TIMED_OUT",
			"Timed out waiting for the spawned debug adapter's TCP listener to become ready.",
		);
	}

	const liveDebugSessions = new Set<string>();
	const debugSessionRoots = new Map<string, string>();
	const issuedDebugSessionIds = new Set<string>();
	const debugEventListeners = new Set<(event: DebugEventPayload) => void>();

	// `F100` S5 — a deliberately small-scale mirror of
	// `src-tauri/src/debug/output_gate.rs`'s real backpressure gate, for the
	// same reason `MockTerminalSession`'s own single-frame-in-flight credit
	// gate mirrors `terminal::service`'s real one: this mock never
	// re-implements a real DAP adapter, but a consuming frontend (the Debug
	// Console view) needs to be able to genuinely drive and observe real
	// gate/ack behavior in a Browser test, not just receive a canned,
	// already-flushed fixture. Deliberately much smaller watermarks/caps than
	// the real Rust constants (`DEBUG_OUTPUT_MOCK_HIGH_WATER_EVENTS`/
	// `DEBUG_OUTPUT_MOCK_MERGE_CAP_BYTES`) so a Browser test can trigger real
	// backpressure with a handful of events rather than needing to actually
	// send tens of thousands.
	const DEBUG_OUTPUT_MOCK_HIGH_WATER_EVENTS = 4;
	const DEBUG_OUTPUT_MOCK_MERGE_CAP_BYTES = 256;
	interface MockDebugOutputMergedCategory {
		text: string;
		elidedBytes: number;
		elidedLines: number;
	}
	interface MockDebugOutputGate {
		nextSequence: number;
		highestEmitted: number;
		highestAcked: number;
		merged: Map<string, MockDebugOutputMergedCategory>;
	}
	const debugOutputGates = new Map<string, MockDebugOutputGate>();

	function mockDebugOutputGate(sessionId: string): MockDebugOutputGate {
		let gate = debugOutputGates.get(sessionId);
		if (gate === undefined) {
			gate = {
				nextSequence: 1,
				highestEmitted: 0,
				highestAcked: 0,
				merged: new Map(),
			};
			debugOutputGates.set(sessionId, gate);
		}
		return gate;
	}

	function mockDebugOutputUnacked(gate: MockDebugOutputGate): number {
		return gate.highestEmitted - gate.highestAcked;
	}

	function mockDebugOutputCategory(body: unknown): string {
		if (typeof body !== "object" || body === null || Array.isArray(body)) {
			return "console";
		}
		const category = (body as Record<string, unknown>).category;
		return typeof category === "string" ? category : "console";
	}

	function mockDebugOutputText(body: unknown): string | undefined {
		if (typeof body !== "object" || body === null || Array.isArray(body)) {
			return undefined;
		}
		const output = (body as Record<string, unknown>).output;
		return typeof output === "string" ? output : undefined;
	}

	function mergeMockDebugOutput(
		gate: MockDebugOutputGate,
		category: string,
		text: string,
	): void {
		const entry = gate.merged.get(category) ?? {
			text: "",
			elidedBytes: 0,
			elidedLines: 0,
		};
		entry.text += text;
		if (entry.text.length > DEBUG_OUTPUT_MOCK_MERGE_CAP_BYTES) {
			const overflow = entry.text.length - DEBUG_OUTPUT_MOCK_MERGE_CAP_BYTES;
			const dropped = entry.text.slice(0, overflow);
			entry.text = entry.text.slice(overflow);
			entry.elidedBytes += dropped.length;
			entry.elidedLines += (dropped.match(/\n/gu) ?? []).length;
		}
		gate.merged.set(category, entry);
	}

	/** Emits every merged category this mock's own credit currently allows —
	 * mirrors `OutputGate::ack`'s "drain as many as credit permits" contract. */
	function flushMockDebugOutput(
		sessionId: string,
		gate: MockDebugOutputGate,
	): void {
		while (
			gate.merged.size > 0 &&
			mockDebugOutputUnacked(gate) < DEBUG_OUTPUT_MOCK_HIGH_WATER_EVENTS
		) {
			const nextCategory = gate.merged.keys().next().value;
			if (nextCategory === undefined) {
				break;
			}
			const entry = gate.merged.get(nextCategory);
			gate.merged.delete(nextCategory);
			if (entry === undefined) {
				break;
			}
			if (entry.elidedBytes > 0) {
				emitMockDebugEvent(sessionId, "plain/outputElided", {
					category: nextCategory,
					elidedBytes: entry.elidedBytes,
					elidedLines: entry.elidedLines,
				});
			}
			const sequence = gate.nextSequence;
			gate.nextSequence += 1;
			gate.highestEmitted = sequence;
			emitMockDebugEvent(sessionId, "output", {
				category: nextCategory,
				output: entry.text,
				sequence,
			});
		}
	}

	/** The mock counterpart of `DebugSession::handle_output_event` — routes a
	 * real `output` event through the gate instead of forwarding it straight
	 * through, so a Browser test can genuinely drive backpressure by pushing
	 * more than `DEBUG_OUTPUT_MOCK_HIGH_WATER_EVENTS` events via
	 * `BrowserMockDebugSessionController.emitEvent("output", …)`. */
	function handleMockDebugOutputEvent(sessionId: string, body: unknown): void {
		const text = mockDebugOutputText(body);
		if (text === undefined) {
			emitMockDebugEvent(sessionId, "output", body);
			return;
		}
		const category = mockDebugOutputCategory(body);
		const gate = mockDebugOutputGate(sessionId);
		if (
			gate.merged.size === 0 &&
			mockDebugOutputUnacked(gate) < DEBUG_OUTPUT_MOCK_HIGH_WATER_EVENTS
		) {
			const sequence = gate.nextSequence;
			gate.nextSequence += 1;
			gate.highestEmitted = sequence;
			emitMockDebugEvent(sessionId, "output", {
				category,
				output: text,
				sequence,
			});
			return;
		}
		mergeMockDebugOutput(gate, category, text);
	}

	const nextDebugSessionId = (): string => {
		for (let attempt = 0; attempt < 16; attempt += 1) {
			const bytes = new Uint8Array(16);
			globalThis.crypto.getRandomValues(bytes);
			bytes[6] = (bytes[6]! & 0x0f) | 0x40;
			bytes[8] = (bytes[8]! & 0x3f) | 0x80;
			const hex = [...bytes]
				.map((value) => value.toString(16).padStart(2, "0"))
				.join("");
			const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
				12,
				16,
			)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
			if (!issuedDebugSessionIds.has(id)) {
				issuedDebugSessionIds.add(id);
				return id;
			}
		}
		throw new Error("Browser mock debug session id generation failed.");
	};

	function requireLiveMockDebugSession(
		sessionId: string,
		rootId?: string,
	): void {
		if (!liveDebugSessions.has(sessionId)) {
			throw debugSessionNotFound();
		}
		if (
			rootId !== undefined &&
			(debugSessionRoots.get(sessionId) !== rootId || !roots.has(rootId))
		) {
			throw debugSessionNotFound();
		}
	}

	function emitMockDebugEvent(
		sessionId: string,
		event: string,
		body: unknown,
	): void {
		const payload: DebugEventPayload = Object.freeze({
			sessionId,
			event,
			body,
		});
		for (const listener of debugEventListeners) {
			listener(payload);
		}
	}

	/** Shared by mock `debugLaunch`/`debugAttach` — see
	 * `PlainBridge.debugLaunch`'s own doc comment for why neither ever sends
	 * an initial breakpoint (this mock therefore never models
	 * `initialBreakpoints` either). Enforces the exact same two gates the
	 * real Rust `start_session` does, in the same order: workspace trust
	 * first, then the exact `(command, args, transport)` confirmation —
	 * never spawns/connects (there is nothing to spawn/connect in a browser
	 * mock) until both pass. */
	function startMockDebugSession(
		rootId: string,
		target: DebugAdapterTarget,
		adapterId: string,
		launchArguments: Readonly<Record<string, unknown>>,
	): DebugSessionStartResult {
		const request = frozenDebugSessionStartRequest(
			rootId,
			target,
			adapterId,
			launchArguments,
		);
		if (roots.size === 0 || !terminalTrusted) {
			throw terminalNotTrusted();
		}
		if (!roots.has(request.rootId as string)) {
			throw rootNotAuthorized();
		}
		// `F210` S6 — a `"tcpSpawn"` request is confirmed under the *same*
		// `"tcp"` identity a plain `"tcp"` request uses (see
		// `plain-debug-adapter-launch.ts`'s own `prepareDebugAdapterLaunch`
		// doc comment, and `src-tauri/src/debug/exec.rs`'s
		// `spawn_adapter_as_tcp_companion` for the real Rust side of this
		// same mapping) — never a third, distinct confirmation identity.
		const wireTransport = request.transport as "stdio" | "tcp" | "tcpSpawn";
		const subject: DebugAdapterConfirmationSubject = Object.freeze({
			command: request.command as string,
			args: request.args as readonly string[],
			transport: wireTransport === "tcpSpawn" ? "tcp" : wireTransport,
		});
		if (!debugAdapterConfirmations.has(debugAdapterConfirmationKey(subject))) {
			throw debugAdapterNotConfirmed();
		}
		if (wireTransport === "tcpSpawn") {
			const outcome =
				options.debugFixtureForTest?.tcpSpawnOutcomeForTest ?? "success";
			if (outcome === "processExitedBeforeListening") {
				throw debugAdapterTcpCompanionExited();
			}
			if (outcome === "connectTimedOut") {
				throw debugAdapterTcpCompanionConnectTimedOut();
			}
		}
		const sessionId = nextDebugSessionId();
		liveDebugSessions.add(sessionId);
		debugSessionRoots.set(sessionId, request.rootId as string);
		const capabilities = { ...options.debugFixtureForTest?.capabilities };
		const controller: BrowserMockDebugSessionController = Object.freeze({
			sessionId,
			emitEvent(event: string, body: unknown): void {
				if (!liveDebugSessions.has(sessionId)) {
					return;
				}
				if (event === "output") {
					// `F100` S5 — routed through the mock's own backpressure
					// gate instead of forwarded straight through, so a
					// Browser test can genuinely drive/observe real gate/ack
					// behavior — see `handleMockDebugOutputEvent`'s own doc
					// comment.
					handleMockDebugOutputEvent(sessionId, body);
					return;
				}
				emitMockDebugEvent(sessionId, event, body);
			},
			finish(): void {
				debugOutputGates.delete(sessionId);
				debugSessionRoots.delete(sessionId);
				if (!liveDebugSessions.delete(sessionId)) {
					return;
				}
				emitMockDebugEvent(sessionId, "plain/sessionEnded", {
					reason: "transportClosed",
				});
			},
		});
		options.onDebugSessionForTest?.(controller);
		return Object.freeze({
			sessionId,
			capabilities: Object.freeze(capabilities),
		});
	}

	interface MockTerminalSession {
		readonly sessionId: string;
		cols: number;
		rows: number;
		/** The mock's entire fake PTY state: one echo row's text — see
		 * `BrowserMockTerminalSessionController`'s doc comment for why this
		 * is deliberately not a real VT grid. */
		line: string;
		exited: boolean;
		nextSequence: number;
		lastEmittedSequence: number | null;
		/** Mirrors the real vt thread's single-frame-in-flight emission
		 * credit gate (`FrameEmitGate` in `src-tauri/src/terminal/service.rs`). */
		awaitingAck: boolean;
		/** Set on construction and after every resize; forces the next
		 * eligible frame to report `dirty: "full"` — mirrors
		 * `vt::VtSession::resize`'s guarantee (and matches the real crate's
		 * own construction-time behavior: its very first frame is always a
		 * full redraw). */
		forceFull: boolean;
		/** Whether `line` has changed since the last frame this session
		 * emitted. */
		dirty: boolean;
	}

	const terminalSessions = new Map<string, MockTerminalSession>();
	const issuedTerminalSessionIds = new Set<string>();
	const nextTerminalSessionId = (): string => {
		for (let attempt = 0; attempt < 16; attempt += 1) {
			const bytes = new Uint8Array(16);
			globalThis.crypto.getRandomValues(bytes);
			bytes[6] = (bytes[6]! & 0x0f) | 0x40;
			bytes[8] = (bytes[8]! & 0x3f) | 0x80;
			const hex = [...bytes]
				.map((value) => value.toString(16).padStart(2, "0"))
				.join("");
			const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
				12,
				16,
			)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
			if (!issuedTerminalSessionIds.has(id)) {
				issuedTerminalSessionIds.add(id);
				return id;
			}
		}
		throw new Error("Browser mock terminal session id generation failed.");
	};

	function terminalNotTrusted(): CommandError {
		return commandError(
			"WORKSPACE_NOT_TRUSTED",
			"This workspace has not been granted execution trust.",
		);
	}

	function trustUnavailable(): CommandError {
		return commandError(
			"TRUST_UNAVAILABLE",
			"The workspace trust store is not available for this window.",
		);
	}

	function gitNoRepository(): CommandError {
		return commandError(
			"GIT_NO_REPOSITORY",
			"The current workspace root is not a Git repository.",
		);
	}

	const gitFixture = options.gitFixtureForTest ?? {};
	const defaultGitStatus: GitStatusResult = Object.freeze({
		branch: Object.freeze({
			oid: "0".repeat(40),
			head: "main",
			upstream: null,
		}),
		entries: Object.freeze([]),
	});
	const defaultGitDiffFiles: GitDiffFilesResult = Object.freeze({
		entries: [],
	});
	const gitBlobs = new Map<string, Partial<Record<GitBlobRev, string>>>(
		Object.entries(gitFixture.blobs ?? {}),
	);
	const defaultGitBlameFile: GitBlameFileResult = Object.freeze({
		entries: Object.freeze([]),
		commits: Object.freeze({}),
	});
	const gitBlameFixtures = new Map<string, GitBlameFileResult>(
		Object.entries(gitFixture.blame ?? {}),
	);
	const gitBlameCommitMessages = new Map<string, string>(
		Object.entries(gitFixture.blameCommitMessages ?? {}),
	);
	const defaultGitHistoryList: GitHistoryListResult = Object.freeze({
		entries: Object.freeze([]),
		truncated: false,
	});
	const gitFileHistoryFixtures = new Map<string, GitHistoryListResult>(
		Object.entries(gitFixture.fileHistory ?? {}),
	);
	const gitLineHistoryListFixtures = new Map<string, GitHistoryListResult>(
		Object.entries(gitFixture.lineHistoryList ?? {}),
	);
	const gitLineHistoryDetailFixtures = new Map<string, GitLineHistoryDetail>(
		Object.entries(gitFixture.lineHistoryDetail ?? {}),
	);
	const gitShowCommitFixtures = new Map<string, GitShowCommitResult>(
		Object.entries(gitFixture.showCommit ?? {}),
	);
	const gitCommitBlobs = new Map<string, Readonly<Record<string, string>>>(
		Object.entries(gitFixture.commitBlobs ?? {}),
	);
	const defaultGitLogGraphResult: GitLogGraphResult = Object.freeze({
		nodes: Object.freeze([]),
		truncated: false,
	});
	const gitGraphResult = gitFixture.graphForTest ?? defaultGitLogGraphResult;
	const defaultGitRefsListResult: GitRefsListResult = Object.freeze({
		entries: Object.freeze([]),
		truncated: false,
	});
	const seededGitRefs = gitFixture.refsForTest ?? defaultGitRefsListResult;
	let gitRefEntries: GitRefEntry[] = seededGitRefs.entries.map((entry) => ({
		...entry,
	}));
	const gitRefsTruncated = seededGitRefs.truncated;
	const seededGitRemotes: GitRemotesListResult =
		gitFixture.remotesForTest ??
		Object.freeze({ entries: Object.freeze([]), truncated: false });
	let gitRemoteEntries: GitRemoteEntry[] = seededGitRemotes.entries.map(
		(entry) => ({
			...entry,
			fetchUrls: [...entry.fetchUrls],
			pushUrls: [...entry.pushUrls],
		}),
	);
	const gitRemotesTruncated = seededGitRemotes.truncated;
	const gitReflogListResult: GitReflogListResult =
		gitFixture.reflogForTest ??
		Object.freeze({ entries: Object.freeze([]), truncated: false });
	const gitContributorsListResult: GitContributorsListResult =
		gitFixture.contributorsForTest ??
		Object.freeze({ entries: Object.freeze([]), truncated: false });
	const gitUnmergedBranches = new Set(gitFixture.branchUnmergedForTest ?? []);

	function gitRefsListSnapshot(): GitRefsListResult {
		return Object.freeze({
			entries: Object.freeze(
				gitRefEntries.map((entry) => Object.freeze({ ...entry })),
			),
			truncated: gitRefsTruncated,
		});
	}

	function gitRemotesListSnapshot(): GitRemotesListResult {
		return Object.freeze({
			entries: Object.freeze(
				gitRemoteEntries.map((entry) =>
					Object.freeze({
						...entry,
						fetchUrls: Object.freeze([...entry.fetchUrls]),
						pushUrls: Object.freeze([...entry.pushUrls]),
					}),
				),
			),
			truncated: gitRemotesTruncated,
		});
	}

	function redactGitRemoteUrlForMock(raw: string): string {
		if (
			raw.startsWith("/") ||
			raw.startsWith("./") ||
			raw.startsWith("../") ||
			raw.startsWith("\\\\") ||
			/^[A-Za-z]:[\\/]/.test(raw)
		) {
			return "<local-path>";
		}
		if (raw.startsWith("file://")) {
			return "file://<local-path>";
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

	// --- F090 S4: mutable stash list simulation ----------------------------
	//
	// See `BrowserMockGitFixtureForTest.stashForTest`'s own doc comment for
	// why this never re-implements real stash-commit plumbing (no parent
	// resolution, no reflog) — `src-tauri/src/git/stash/tests.rs` is this
	// slice's authoritative correctness evidence; this array only needs to be
	// self-consistent enough for a consuming frontend to develop and test the
	// full push/apply/pop/drop click-through flow against.
	let gitStashEntries: GitStashEntry[] = (gitFixture.stashForTest ?? []).map(
		(entry) => ({ ...entry }),
	);
	const gitStashShowFixtures = new Map<string, GitStashShowResult>(
		Object.entries(gitFixture.stashShowForTest ?? {}),
	);
	const gitStashConflictFixtures = new Map<string, readonly string[]>(
		Object.entries(gitFixture.stashConflictForTest ?? {}),
	);
	let gitStashCounter = 0;

	function gitStashNotFound(): CommandError {
		return commandError(
			"GIT_STASH_NOT_FOUND",
			"No stash entry with the requested identity exists.",
		);
	}

	function gitStashListSnapshot(): GitStashListResult {
		return Object.freeze({
			entries: Object.freeze(
				gitStashEntries.map((entry, index) => ({ ...entry, index })),
			),
			truncated: false,
		});
	}

	// --- F090 S5: mutable worktree list simulation --------------------------
	//
	// See `BrowserMockGitFixtureForTest.worktreesForTest`'s own doc comment for
	// why this never re-implements real `git worktree` plumbing (no reflog, no
	// actual filesystem directories) — `src-tauri/src/git/worktree/tests.rs`
	// is this slice's authoritative correctness evidence; this array only
	// needs to be self-consistent enough for a consuming frontend to develop
	// and test the full add/remove click-through flow against.
	const defaultWorktreeEntry: GitWorktreeEntry = Object.freeze({
		path: "/workspace",
		headSha: "f0".padEnd(40, "0"),
		headState: Object.freeze({
			kind: "branch" as const,
			refName: "refs/heads/main",
		}),
		lockReason: null,
		prunableReason: null,
		isMain: true,
	});
	let gitWorktreeEntries: GitWorktreeEntry[] = (
		gitFixture.worktreesForTest ?? [defaultWorktreeEntry]
	).map((entry) => ({ ...entry }));
	const gitWorktreeDirtyPaths = new Set<string>(
		gitFixture.worktreeDirtyForTest ?? [],
	);
	let gitWorktreeCounter = 0;

	function gitWorktreeListSnapshot(): GitWorktreeListResult {
		return Object.freeze({
			entries: Object.freeze(gitWorktreeEntries.map((entry) => ({ ...entry }))),
			truncated: false,
		});
	}

	function gitWorktreeRemoveIsMainWorktree(): CommandError {
		return commandError(
			"GIT_WORKTREE_REMOVE_IS_MAIN_WORKTREE",
			"The main worktree cannot be removed.",
		);
	}

	function gitWorktreeRemoveLocked(): CommandError {
		return commandError(
			"GIT_WORKTREE_REMOVE_LOCKED",
			"This worktree is locked and must be unlocked before it can be removed.",
		);
	}

	function gitWorktreeRemoveNotFound(): CommandError {
		return commandError(
			"GIT_WORKTREE_REMOVE_NOT_FOUND",
			"That path is not a registered worktree of this repository.",
		);
	}

	// --- F080 S3: mutable stage/unstage/commit/discard simulation ---------
	//
	// `gitBranch`/`gitEntries` start from the injected fixture (or the clean
	// default) and are mutated in place by `gitStagePaths`/`gitUnstagePaths`/
	// `gitStageBlob`/`gitCommit`/`gitDiscardPaths` below — this mock never
	// re-implements real git plumbing (no hashing, no index file), only
	// enough of porcelain-v2's index/worktree status-character semantics to
	// let a consuming frontend (`PlainScmProvider`) observe a believable
	// state transition after each write call. The Rust-side fixtures in
	// `src-tauri/src/git/stage/tests.rs`/`commit/tests.rs`/`discard/tests.rs`
	// are this slice's authoritative correctness evidence; this simulation
	// only needs to be self-consistent enough for frontend development and
	// Browser E2E to exercise the full click-through flow.
	let gitBranch: GitBranch = (gitFixture.status ?? defaultGitStatus).branch;
	let gitEntries: GitStatusEntry[] = (
		gitFixture.status ?? defaultGitStatus
	).entries.map((entry) => ({ ...entry }));
	let gitCommitCounter = 0;
	let gitHistoryPreviewCounter = 0;
	let gitHistorySequencer: GitHistoryState["sequencer"] = null;
	let lastGitHistoryPreview:
		| Readonly<{
				operation: GitHistoryOperation;
				targetSha: string;
				previewToken: string;
		  }>
		| undefined;

	function gitHistoryStateSnapshot(): GitHistoryState {
		return Object.freeze({
			headSha: gitBranch.oid,
			sequencer:
				gitHistorySequencer === null
					? null
					: Object.freeze({
							kind: gitHistorySequencer.kind,
							conflictedPaths: Object.freeze([
								...gitHistorySequencer.conflictedPaths,
							]),
							pathsTruncated: gitHistorySequencer.pathsTruncated,
						}),
		});
	}

	function gitHistoryPathProjection(): Readonly<{
		workingTreePaths: readonly string[];
		stagedPaths: readonly string[];
		conflictedPaths: readonly string[];
		pathsTruncated: boolean;
	}> {
		const workingTreePaths: string[] = [];
		const stagedPaths: string[] = [];
		const conflictedPaths: string[] = [];
		let pathsTruncated = false;
		const push = (target: string[], path: string) => {
			if (target.includes(path)) {
				return;
			}
			if (target.length === 256) {
				pathsTruncated = true;
				return;
			}
			target.push(path);
		};
		for (const entry of gitEntries) {
			if (entry.type === "ordinary" || entry.type === "renameOrCopy") {
				if (entry.indexStatus !== ".") {
					push(stagedPaths, entry.path);
				}
				if (entry.worktreeStatus !== ".") {
					push(workingTreePaths, entry.path);
				}
			}
			if (entry.type === "unmerged") {
				push(conflictedPaths, entry.path);
			}
		}
		return Object.freeze({
			workingTreePaths: Object.freeze(workingTreePaths),
			stagedPaths: Object.freeze(stagedPaths),
			conflictedPaths: Object.freeze(conflictedPaths),
			pathsTruncated,
		});
	}

	function gitHistoryPreviewSnapshot(
		operation: GitHistoryOperation,
		targetSha: string,
	): GitHistoryPreview {
		gitHistoryPreviewCounter += 1;
		const previewToken = gitHistoryPreviewCounter
			.toString(16)
			.padStart(64, "0");
		const paths = gitHistoryPathProjection();
		lastGitHistoryPreview = Object.freeze({
			operation,
			targetSha,
			previewToken,
		});
		return Object.freeze({
			operation,
			targetSha,
			headSha: gitBranch.oid,
			ahead: 0,
			behind: 0,
			...paths,
			sequencer: gitHistoryStateSnapshot().sequencer,
			previewToken,
		});
	}

	function gitHistoryOperationSequencer(
		operation: GitHistoryOperation,
	): GitSequencerKind | undefined {
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

	function gitHistoryExecute(
		operation: GitHistoryOperation,
		targetSha: string,
		previewToken: string,
	): GitHistoryMutationOutcome {
		if (
			lastGitHistoryPreview?.operation !== operation ||
			lastGitHistoryPreview.targetSha !== targetSha ||
			lastGitHistoryPreview.previewToken !== previewToken
		) {
			throw commandError(
				"GIT_HISTORY_PREVIEW_STALE",
				"The Git repository changed after the operation preview. Review it again before continuing.",
			);
		}
		lastGitHistoryPreview = undefined;
		const conflictPaths = gitFixture.historyConflictForTest?.[operation];
		const sequencerKind = gitHistoryOperationSequencer(operation);
		if (
			sequencerKind !== undefined &&
			conflictPaths !== undefined &&
			conflictPaths.length > 0
		) {
			gitHistorySequencer = Object.freeze({
				kind: sequencerKind,
				conflictedPaths: Object.freeze(conflictPaths.slice(0, 256)),
				pathsTruncated: conflictPaths.length > 256,
			});
			return Object.freeze({
				kind: "conflicts",
				state: gitHistoryStateSnapshot(),
			});
		}
		gitHistorySequencer = null;
		gitCommitCounter += 1;
		const nextHead =
			operation.startsWith("reset") || operation === "merge"
				? targetSha
				: gitCommitCounter.toString(16).padStart(40, "0");
		gitBranch = { ...gitBranch, oid: nextHead };
		return Object.freeze({
			kind: "completed",
			state: gitHistoryStateSnapshot(),
		});
	}

	const ZERO_GIT_HASH = "0".repeat(40);
	const ZERO_GIT_SUBMODULE = Object.freeze({
		isSubmodule: false,
		commitChanged: false,
		trackedChanged: false,
		untrackedChanged: false,
	});

	// --- F080 S4: mutable fetch/pull/push simulation -----------------------
	//
	// See `BrowserMockGitNetworkFixtureForTest`'s own doc comment for why this
	// never re-implements real ahead/behind or non-fast-forward semantics —
	// `src-tauri/src/git/network/tests.rs` is this slice's authoritative
	// correctness evidence.
	const gitNetworkFixture = gitFixture.networkForTest ?? {};
	let gitNetworkUpstream: string | null =
		gitNetworkFixture.upstream === undefined
			? "origin/main"
			: gitNetworkFixture.upstream;
	let gitNetworkAhead = gitNetworkFixture.ahead ?? 0;
	let gitNetworkBehind = gitNetworkFixture.behind ?? 0;

	function gitMutateUnavailable(rootId?: string): CommandError | undefined {
		if (roots.size === 0 || !terminalTrusted) {
			return terminalNotTrusted();
		}
		if (rootId === undefined) {
			if (roots.size !== 1) {
				return commandError(
					"GIT_ROOT_REQUIRED",
					"Select a workspace root before running a Git operation.",
				);
			}
		} else if (!roots.has(frozenGitRootId(rootId))) {
			return commandError(
				"ROOT_NOT_AUTHORIZED",
				"The requested workspace root is not authorized for this window.",
			);
		}
		if (gitFixture.noRepositoryForTest === true) {
			return gitNoRepository();
		}
		return undefined;
	}

	function gitManagementError(code: string, message: string): CommandError {
		return commandError(code, message);
	}

	function gitLocalBranch(name: string): GitRefEntry | undefined {
		return gitRefEntries.find(
			(entry) => entry.kind === "branch" && entry.shortName === name,
		);
	}

	function gitTag(name: string): GitRefEntry | undefined {
		return gitRefEntries.find(
			(entry) => entry.kind === "tag" && entry.shortName === name,
		);
	}

	function gitRemote(name: string): GitRemoteEntry | undefined {
		return gitRemoteEntries.find((entry) => entry.name === name);
	}

	function shortUpstream(fullName: string | null): string | null {
		return fullName?.startsWith("refs/remotes/") === true
			? fullName.slice("refs/remotes/".length)
			: null;
	}

	function gitNetworkNoUpstream(): CommandError {
		return commandError(
			"GIT_NETWORK_NO_UPSTREAM",
			"The current branch has no upstream configured.",
		);
	}

	function gitPushRejected(): CommandError {
		return commandError(
			"GIT_PUSH_REJECTED",
			"The remote rejected the push (it has commits this branch does not).",
		);
	}

	function gitDiscardFailed(): CommandError {
		return commandError(
			"GIT_DISCARD_FAILED",
			"git checkout did not complete successfully.",
		);
	}

	function gitCommitNothingToCommit(): CommandError {
		return commandError(
			"GIT_COMMIT_NOTHING_TO_COMMIT",
			"There are no staged changes to commit.",
		);
	}

	function findGitEntryIndex(path: string): number {
		return gitEntries.findIndex(
			(entry) =>
				(entry.type === "ordinary" ||
					entry.type === "renameOrCopy" ||
					entry.type === "untracked") &&
				entry.path === path,
		);
	}

	function newOrdinaryGitEntry(
		indexStatus: string,
		worktreeStatus: string,
		path: string,
	): GitStatusEntry {
		return {
			type: "ordinary",
			indexStatus,
			worktreeStatus,
			submodule: ZERO_GIT_SUBMODULE,
			modeHead: "100644",
			modeIndex: "100644",
			modeWorktree: "100644",
			hashHead: ZERO_GIT_HASH,
			hashIndex: ZERO_GIT_HASH,
			path,
		};
	}

	/** Moves the worktree-side change at `path` (partly, when `wholeFile` is
	 * `false`) onto the index side — `gitStagePaths` (`git add -A`) always
	 * passes `wholeFile: true` (worktree status clears to `.`); `gitStageBlob`
	 * (hunk-level) passes `false`, deliberately leaving the worktree status
	 * exactly as it was, simulating the real `MM`-shaped partial stage
	 * `src-tauri/src/git/stage/tests.rs`'s
	 * `stage_blob_partially_stages_a_file_and_status_reports_mm` proves
	 * server-side. */
	function gitStageOnePath(path: string, wholeFile: boolean): void {
		const index = findGitEntryIndex(path);
		if (index === -1) {
			return;
		}
		const entry = gitEntries[index]!;
		if (entry.type === "untracked") {
			gitEntries[index] = newOrdinaryGitEntry("A", wholeFile ? "." : "M", path);
			return;
		}
		if (entry.type !== "ordinary" && entry.type !== "renameOrCopy") {
			return;
		}
		if (entry.worktreeStatus === ".") {
			return;
		}
		gitEntries[index] = {
			...entry,
			indexStatus: entry.worktreeStatus,
			worktreeStatus: wholeFile ? "." : entry.worktreeStatus,
		};
	}

	function gitUnstageOnePath(path: string): void {
		const index = findGitEntryIndex(path);
		if (index === -1) {
			return;
		}
		const entry = gitEntries[index]!;
		if (entry.type !== "ordinary" && entry.type !== "renameOrCopy") {
			return;
		}
		if (entry.indexStatus === ".") {
			return;
		}
		if (entry.indexStatus === "A" && entry.worktreeStatus === ".") {
			gitEntries[index] = { type: "untracked", path };
			return;
		}
		gitEntries[index] = {
			...entry,
			worktreeStatus: entry.indexStatus,
			indexStatus: ".",
		};
	}

	/** `true` only when `path` currently has a worktree-side change a discard
	 * could meaningfully restore — mirrors real `git checkout -q --`'s
	 * pathspec-resolution-before-touching-anything semantics
	 * (`src-tauri/src/git/discard/tests.rs`'s
	 * `discard_paths_is_all_or_nothing_when_one_path_is_untracked`): an
	 * untracked path (or a path with no worktree change at all) cannot be
	 * discarded, and `gitDiscardPaths` below checks every path with this
	 * function *before* mutating any of them. */
	function gitPathIsDiscardable(path: string): boolean {
		const index = findGitEntryIndex(path);
		if (index === -1) {
			return false;
		}
		const entry = gitEntries[index]!;
		return (
			(entry.type === "ordinary" || entry.type === "renameOrCopy") &&
			entry.worktreeStatus !== "."
		);
	}

	function gitDiscardOnePath(path: string): void {
		const index = findGitEntryIndex(path);
		if (index === -1) {
			return;
		}
		const entry = gitEntries[index]!;
		if (entry.type !== "ordinary" && entry.type !== "renameOrCopy") {
			return;
		}
		if (entry.indexStatus === ".") {
			gitEntries.splice(index, 1);
		} else {
			gitEntries[index] = { ...entry, worktreeStatus: "." };
		}
	}

	function gitHasStagedChanges(): boolean {
		return gitEntries.some(
			(entry) =>
				(entry.type === "ordinary" || entry.type === "renameOrCopy") &&
				entry.indexStatus !== ".",
		);
	}

	/** Drops every fully-committed entry (both axes now `.`) and clears the
	 * index axis of every remaining one — the same "commit only touches the
	 * staged half" semantics `git commit` has in reality. Also advances a
	 * fake, deterministic commit oid so `gitStatus().branch.oid` visibly
	 * changes after a commit, matching real `git commit` always producing a
	 * new oid (including `--amend`, which still replaces the oid even though
	 * the tree may be identical). */
	function gitCommitStagedEntries(): void {
		const nextEntries: GitStatusEntry[] = [];
		for (const entry of gitEntries) {
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
		gitEntries = nextEntries;
		gitCommitCounter += 1;
		gitBranch = {
			...gitBranch,
			oid: gitCommitCounter.toString(16).padStart(40, "0"),
		};
	}

	function terminalSessionNotFound(): CommandError {
		return commandError(
			"TERMINAL_SESSION_NOT_FOUND",
			"The requested terminal session does not exist for this window.",
		);
	}

	function terminalIoFailed(): CommandError {
		return commandError("IO_FAILED", "The terminal session could not be used.");
	}

	function getMockTerminalSession(sessionId: string): MockTerminalSession {
		const session = terminalSessions.get(sessionId);
		if (session === undefined) {
			throw terminalSessionNotFound();
		}
		return session;
	}

	/** Builds this session's single-row frame value at its current state —
	 * an own-data plain object handed to `frozenTerminalDataEvent`, which
	 * re-validates and freezes it through the same decoder a real wire
	 * payload goes through. */
	function buildMockTerminalFrameValue(
		session: MockTerminalSession,
		dirty: "full" | "partial",
	): unknown {
		// F190 S4 "Ghostty metadata and links": this mock's single-echo-row
		// fake PTY (see `BrowserMockTerminalSessionController`'s own doc
		// comment for why it is deliberately not a real VT emulator) never
		// itself produces a hyperlink/semantic-tagged cell or a live OSC 7
		// pwd — every cell/row below carries the fixed "no metadata" values
		// (`hyperlink: null`, `semantic: "output"`, `semanticPrompt: "none"`),
		// and the frame's own `pwd` is always `null`. Renderer/codec unit
		// tests that need a *specific* hyperlink/semantic/pwd shape build a
		// `TerminalFrame` fixture object directly instead of routing through
		// this mock; the richer Playwright-only fixture in
		// `tests/browser/workspace.spec.ts` covers the full Browser E2E
		// scenarios for this metadata (see that file's own `FakeTerminalSession`).
		const cells = [...session.line].map((character) => ({
			graphemes: character,
			fg: null,
			bg: null,
			style: MOCK_TERMINAL_DEFAULT_STYLE,
			hyperlink: null,
			semantic: "output",
		}));
		return {
			dirty,
			cols: session.cols,
			rows: session.rows,
			cursor: {
				visible: true,
				blinking: false,
				viewport: { x: cells.length, y: 0, atWideTail: false },
				style: "block",
			},
			colors: {
				background: MOCK_TERMINAL_BACKGROUND,
				foreground: MOCK_TERMINAL_FOREGROUND,
				cursor: null,
			},
			rowsData: [{ rowIndex: 0, semanticPrompt: "none", cells }],
			pwd: null,
		};
	}

	/** Attempts to snapshot and emit a frame right now — the mock analogue
	 * of `FrameEmitGate::try_take_frame` + `attempt_emit`
	 * (`src-tauri/src/terminal/service.rs`): a no-op whenever a previously
	 * emitted frame is still unacknowledged, or nothing has actually
	 * changed since the last one (and this is not a forced full redraw). */
	function attemptEmitMockTerminalFrame(session: MockTerminalSession): void {
		if (session.awaitingAck || (!session.dirty && !session.forceFull)) {
			return;
		}
		const dirty: "full" | "partial" = session.forceFull ? "full" : "partial";
		const sequence = session.nextSequence;
		session.nextSequence += 1;
		session.lastEmittedSequence = sequence;
		session.awaitingAck = true;
		session.forceFull = false;
		session.dirty = false;
		const event = frozenTerminalDataEvent(
			session.sessionId,
			sequence,
			buildMockTerminalFrameValue(session, dirty),
		);
		queueMicrotask(() => {
			for (const listener of terminalDataListeners) {
				listener(event);
			}
		});
	}

	/** Frees the emission credit once the frontend has acked up through
	 * `sequence` — mirrors `FrameEmitGate::ack`'s tolerant contract (a stale
	 * or duplicate ack below the last emitted sequence is simply ignored). */
	function ackMockTerminalSession(
		session: MockTerminalSession,
		sequence: number,
	): void {
		if (
			session.lastEmittedSequence !== null &&
			sequence >= session.lastEmittedSequence
		) {
			session.awaitingAck = false;
			attemptEmitMockTerminalFrame(session);
		}
	}

	/** Appends `text` to the session's echo row and attempts an emission —
	 * shared by `terminalInputText`'s own echo, `terminalInputKey`'s
	 * `utf8`-only echo, and `pushOutput`'s test-only injection. */
	function pushMockTerminalOutput(
		session: MockTerminalSession,
		text: string,
	): void {
		if (session.exited || text.length === 0) {
			return;
		}
		session.line += text;
		session.dirty = true;
		attemptEmitMockTerminalFrame(session);
	}

	function resizeMockTerminalSession(
		session: MockTerminalSession,
		cols: number,
		rows: number,
	): void {
		session.cols = cols;
		session.rows = rows;
		session.forceFull = true;
		attemptEmitMockTerminalFrame(session);
	}

	/** Reports `session` as exited exactly once — shared by the test
	 * controller's `finish` and `terminalKill`'s own exit notification, so a
	 * natural `finish()` that raced ahead of a `terminalKill` call is never
	 * overwritten or double-reported (mirrors the real one-shot exit-event
	 * contract). Deliberately does not force-flush any not-yet-emitted
	 * (credit-gated) pending content: this mirrors the real exit-vs-last-
	 * frame race `terminal::service`'s module doc documents rather than
	 * "fixing" it away. */
	function finishMockTerminalSession(
		session: MockTerminalSession,
		exitCode: number,
		signal: string | null = null,
	): void {
		if (session.exited) {
			return;
		}
		session.exited = true;
		const event = frozenTerminalExitEvent(session.sessionId, exitCode, signal);
		queueMicrotask(() => {
			for (const listener of terminalExitListeners) {
				listener(event);
			}
		});
	}

	function startMockTerminalSession(
		cols: number,
		rows: number,
	): MockTerminalSession {
		const sessionId = nextTerminalSessionId();
		const session: MockTerminalSession = {
			sessionId,
			cols,
			rows,
			line: "",
			exited: false,
			nextSequence: 0,
			lastEmittedSequence: null,
			awaitingAck: false,
			forceFull: true,
			dirty: false,
		};
		terminalSessions.set(sessionId, session);
		const controller: BrowserMockTerminalSessionController = Object.freeze({
			sessionId,
			pushOutput(text: string): void {
				pushMockTerminalOutput(session, text);
			},
			finish(exitCode: number, signal: string | null = null): void {
				finishMockTerminalSession(session, exitCode, signal);
			},
			isAwaitingAckForTest: (): boolean => session.awaitingAck,
			lastEmittedSequenceForTest: (): number | null =>
				session.lastEmittedSequence,
		});
		options.onTerminalSessionForTest?.(controller);
		return session;
	}

	let activeTextSearch: MockTextSearch | undefined;
	const textSearchWakeListeners = new Set<(searchId: string) => void>();
	const emitTextSearchWake = (searchId: string): void => {
		queueMicrotask(() => {
			for (const listener of textSearchWakeListeners) {
				listener(searchId);
			}
		});
	};

	const TEXT_SEARCH_PREVIEW_MAX_UTF16_UNITS = 256;

	const buildMockPreview = (
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

	const escapeMockRegExp = (value: string): string =>
		value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

	/** Matches lookahead (`(?=`/`(?!`), lookbehind (`(?<=`/`(?<!`) and
	 * backreference (`\1`-`\9`) syntax — the PCRE2-only constructs the real
	 * Rust engine (`grep-regex`, a linear-time engine) rejects as
	 * `INVALID_SEARCH_REGEX` (see `text_search.rs`'s `compile_query` doc
	 * comment and its `regex_pcre2_only_constructs_are_rejected_per_construct_
	 * with_a_path_free_message` test, F200 S3). The native `RegExp`
	 * constructor this mock otherwise delegates to happily *accepts* all
	 * three (V8's engine supports them) and would silently diverge from the
	 * real backend's rejection without this explicit, pre-compile check. */
	const PCRE2_ONLY_REGEX_CONSTRUCT = /\(\?<?[=!]|\\[1-9]/;

	const compileMockTextMatcher = (
		pattern: string,
		isRegExp: boolean,
		isCaseSensitive: boolean,
		isWordMatch: boolean,
	): RegExp => {
		if (isRegExp && PCRE2_ONLY_REGEX_CONSTRUCT.test(pattern)) {
			throw invalidSearchRegex();
		}
		const source = isRegExp ? pattern : escapeMockRegExp(pattern);
		const wrapped = isWordMatch ? `\\b(?:${source})\\b` : source;
		try {
			return new RegExp(wrapped, isCaseSensitive ? "gu" : "giu");
		} catch {
			throw invalidSearchRegex();
		}
	};

	const searchWorkspaceTextMatches = (
		request: Readonly<{
			roots: readonly string[];
			pattern: string;
			isRegExp: boolean;
			isCaseSensitive: boolean;
			isWordMatch: boolean;
			excludeGlobs: readonly string[];
			maxResults: number;
			maxFileSize: number | null;
		}>,
	): Omit<MockTextSearch, "searchId" | "deliveredCursor"> => {
		for (const rootId of request.roots) {
			if (!roots.has(rootId)) {
				throw rootNotAuthorized();
			}
		}
		const matcher = compileMockTextMatcher(
			request.pattern,
			request.isRegExp,
			request.isCaseSensitive,
			request.isWordMatch,
		);
		const excludeMatchers = request.excludeGlobs.map(compileMockExcludeGlob);
		const maxFileSize = request.maxFileSize ?? 8 * 1_024 * 1_024;
		const maxResults = Math.min(
			request.maxResults,
			MAX_MOCK_TEXT_SEARCH_MATCHES,
		);

		const pending: MockTextSearchBatch[] = [];
		let limitHit = false;
		let skippedBinary = 0;
		let skippedOversize = 0;
		let remainingBudget = maxResults;
		let visited = 0;

		interface SearchFrame {
			readonly directory: MockDirectoryNode;
			readonly wire: string;
			readonly depth: number;
			readonly gitignoreChain: readonly MockGitignoreLayer[];
			readonly names: readonly string[];
			nextIndex: number;
		}

		rootsLoop: for (const rootId of request.roots) {
			const root = trees.get(rootId);
			if (root === undefined || root.kind !== "directory") {
				continue;
			}
			const frames: SearchFrame[] = [
				{
					directory: root,
					wire: "",
					depth: 0,
					gitignoreChain: [mockGitignoreLayerFor(root, "")],
					names: [...root.entries.keys()].sort(compareWorkspaceEntryNames),
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
				if (visited > MAX_MOCK_SEARCH_TREE_ENTRIES) {
					limitHit = true;
					break rootsLoop;
				}
				const child = frame.directory.entries.get(name);
				if (child === undefined) {
					continue;
				}
				const wire = frame.wire.length === 0 ? name : `${frame.wire}/${name}`;
				const isDir = child.kind === "directory";
				const excluded =
					excludeMatchers.some((matches) => matches(wire)) ||
					mockPathIsGitignored(frame.gitignoreChain, wire, isDir);

				if (child.kind === "directory") {
					if (excluded) {
						continue;
					}
					const depth = frame.depth + 1;
					if (depth > MAX_MOCK_SEARCH_TREE_DEPTH) {
						limitHit = true;
						continue;
					}
					frames.push({
						directory: child,
						wire,
						depth,
						gitignoreChain: [
							...frame.gitignoreChain,
							mockGitignoreLayerFor(child, wire),
						],
						names: [...child.entries.keys()].sort(compareWorkspaceEntryNames),
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
				const text = lenientTextDecoder.decode(child.bytes);
				const lines = text.split("\n");
				const matches: {
					line: number;
					column: number;
					length: number;
					previewText: string;
					absoluteColumn: number;
				}[] = [];
				lineLoop: for (const [lineIndex, rawLine] of lines.entries()) {
					const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
					for (const found of line.matchAll(matcher)) {
						if (remainingBudget <= 0) {
							break lineLoop;
						}
						const { previewText, column } = buildMockPreview(
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
					pending.push(
						Object.freeze({
							rootId,
							path: wire,
							matches: Object.freeze(matches),
						}),
					);
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
	// (`src-tauri/src/search/replace.rs`): builds the same word/case-wrapped
	// matcher `compileMockTextMatcher` uses (but with no "g" flag — this only
	// ever needs a single anchored full-string match, never iteration), then
	// tokenizes the template and resolves each `$`-reference itself rather
	// than relying on any built-in JS replace-string semantics, so an
	// out-of-range group reference can fail closed instead of silently
	// becoming an empty string. See that Rust module's own doc comment for
	// why anchoring is an explicit post-match bounds check (`match.index`/
	// match length) rather than `^`/`$` woven into the pattern text.
	const compileMockReplaceMatcher = (
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
	type MockTemplateToken =
		| { readonly kind: "literal"; readonly text: string }
		| { readonly kind: "ref"; readonly ref: string };
	const MOCK_TEMPLATE_REF_CHAR = /[0-9A-Za-z_]/;
	const tokenizeMockReplaceTemplate = (
		template: string,
	): MockTemplateToken[] => {
		const tokens: MockTemplateToken[] = [];
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
				MOCK_TEMPLATE_REF_CHAR.test(template[cursor]!)
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
	const MAX_MOCK_REPLACE_EXPAND_OUTPUT_UNITS = 8_192;
	const mockReplaceExpandNoMatch =
		(): WorkspaceSearchExpandReplacementItem => ({
			status: "error",
			code: "SEARCH_REPLACE_EXPAND_NO_MATCH",
			message: "The recorded match text no longer matches the search pattern.",
		});
	const mockReplaceExpandInvalidGroup =
		(): WorkspaceSearchExpandReplacementItem => ({
			status: "error",
			code: "SEARCH_REPLACE_EXPAND_INVALID_GROUP",
			message:
				"The replacement template references a capture group the pattern does not have.",
		});
	const mockReplaceExpandTooLarge =
		(): WorkspaceSearchExpandReplacementItem => ({
			status: "error",
			code: "SEARCH_REPLACE_EXPAND_TOO_LARGE",
			message: "The expanded replacement text is too large.",
		});
	const expandMockReplacementEntry = (
		matcher: RegExp,
		tokens: readonly MockTemplateToken[],
		expectedText: string,
	): WorkspaceSearchExpandReplacementItem => {
		const match = matcher.exec(expectedText);
		if (
			match === null ||
			match.index !== 0 ||
			match[0].length !== expectedText.length
		) {
			return mockReplaceExpandNoMatch();
		}
		let output = "";
		for (const token of tokens) {
			let addition: string;
			if (token.kind === "literal") {
				addition = token.text;
			} else if (/^\d+$/.test(token.ref)) {
				const groupIndex = Number(token.ref);
				if (groupIndex >= match.length) {
					return mockReplaceExpandInvalidGroup();
				}
				addition = match[groupIndex] ?? "";
			} else {
				const groups = match.groups ?? {};
				if (!Object.hasOwn(groups, token.ref)) {
					return mockReplaceExpandInvalidGroup();
				}
				addition = groups[token.ref] ?? "";
			}
			if (
				output.length + addition.length >
				MAX_MOCK_REPLACE_EXPAND_OUTPUT_UNITS
			) {
				return mockReplaceExpandTooLarge();
			}
			output += addition;
		}
		return { status: "ok", replacement: output };
	};
	const expandWorkspaceSearchReplacements = (
		request: Readonly<{
			pattern: string;
			isCaseSensitive: boolean;
			isWordMatch: boolean;
			replacementTemplate: string;
			expectedTexts: readonly string[];
		}>,
	): readonly WorkspaceSearchExpandReplacementItem[] => {
		const matcher = compileMockReplaceMatcher(
			request.pattern,
			request.isCaseSensitive,
			request.isWordMatch,
		);
		const tokens = tokenizeMockReplaceTemplate(request.replacementTemplate);
		return request.expectedTexts.map((expectedText) =>
			expandMockReplacementEntry(matcher, tokens, expectedText),
		);
	};

	// `F220` S1 — the mock's own in-memory SSH known-hosts pin store and live
	// session table. Never the real Rust store/registry: a fresh page load
	// (a fresh `createBrowserMockBridge` call) starts empty except for
	// `remoteFixtureForTest.pinnedHostsForTest`, exactly like every other
	// in-memory mock domain in this file (backup/scratch/theme selection).
	const remoteFixture = options.remoteFixtureForTest ?? {};
	const remoteKnownHosts = new Map<
		string,
		Readonly<{ algorithm: string; sha256Fingerprint: string }>
	>();
	for (const target of remoteFixture.pinnedHostsForTest ?? []) {
		remoteKnownHosts.set(
			remoteMockTargetKey(target.host, target.port),
			Object.freeze({
				algorithm: "ssh-ed25519",
				sha256Fingerprint: remoteMockFingerprint(
					target.host,
					target.port,
					false,
				),
			}),
		);
	}
	const remoteSessions = new Map<
		string,
		Readonly<{ host: string; port: number; user: string }>
	>();
	const remoteSessionListeners = new Set<
		(payload: RemoteSessionEventPayload) => void
	>();

	function remoteSessionNotFound(): CommandError {
		return commandError(
			"REMOTE_SESSION_NOT_FOUND",
			"The requested SSH session does not exist for this window.",
		);
	}

	function remoteAgentAuthRejected(): CommandError {
		return commandError(
			"REMOTE_AGENT_AUTH_REJECTED",
			"The server rejected every identity the SSH agent offered.",
		);
	}

	function remoteConnectTimedOut(): CommandError {
		return commandError(
			"REMOTE_CONNECT_TIMED_OUT",
			"Timed out waiting to establish an SSH connection to the requested host.",
		);
	}

	function remoteHostKeyChanged(
		host: string,
		port: number,
		algorithm: string,
		oldFingerprint: string,
		newFingerprint: string,
	): CommandError {
		return commandError(
			"REMOTE_HOST_KEY_CHANGED",
			`The host key for ${host}:${port} has changed. Previously pinned (${algorithm}): ` +
				`${oldFingerprint}. Now offered: ${newFingerprint}. This may indicate the host was ` +
				"reinstalled or a man-in-the-middle attack; the existing pin must be explicitly " +
				"forgotten (Plain: Forget SSH Host Key…) before reconnecting.",
		);
	}

	function remoteEmit(payload: RemoteSessionEventPayload): void {
		for (const listener of remoteSessionListeners) {
			listener(payload);
		}
	}

	/** Completes a connect once the host key itself has already been
	 * accepted (a matching pin existed, or `remoteHostKeyConfirm` just
	 * pinned it) — the shared tail both mock entry points below reach. */
	function remoteCompleteConnect(
		host: string,
		port: number,
		user: string,
	): RemoteSessionConnectResult {
		const outcome =
			remoteFixture.connectOutcomesForTest?.[remoteMockTargetKey(host, port)] ??
			"success";
		if (outcome === "authRejected") {
			throw remoteAgentAuthRejected();
		}
		if (outcome === "connectTimedOut") {
			throw remoteConnectTimedOut();
		}
		const sessionId = nextDebugSessionId();
		remoteSessions.set(sessionId, Object.freeze({ host, port, user }));
		remoteEmit(
			Object.freeze({ event: "connected", sessionId, host, port, user }),
		);
		return Object.freeze({ status: "connected", sessionId });
	}

	return {
		async runtimeInfo() {
			queueMicrotask(() => {
				for (const listener of listeners) {
					listener(runtimeInfo);
				}
			});
			return runtimeInfo;
		},
		async windowCreate() {
			if (options.onWindowCreateForTest !== undefined) {
				options.onWindowCreateForTest();
				return;
			}
			window.open(window.location.href, "_blank", "noopener,noreferrer");
		},
		async onRuntimeReady(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		async onNativeCloseRequested(listener) {
			nativeCloseListeners.add(listener);
			return () => {
				nativeCloseListeners.delete(listener);
			};
		},
		async lifecycleCompleteClose() {},
		async lifecycleRequestClose() {
			const bytes = new Uint8Array(16);
			globalThis.crypto.getRandomValues(bytes);
			bytes[6] = (bytes[6]! & 0x0f) | 0x40;
			bytes[8] = (bytes[8]! & 0x3f) | 0x80;
			const hex = [...bytes]
				.map((value) => value.toString(16).padStart(2, "0"))
				.join("");
			const request = Object.freeze({
				requestId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
					12,
					16,
				)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
				reason: "close" as const,
				timeoutMs: 5_000 as const,
			});
			for (const listener of nativeCloseListeners) listener(request);
		},
		async userDataRead(resource) {
			const entry = userDataEntries.get(resource);
			if (entry === undefined) {
				throw Object.freeze({
					code: "USER_DATA_INVALID",
					message: "The local user-data resource is not supported.",
				});
			}
			return Object.freeze({
				resource,
				revision: entry.revision,
				content: entry.content,
			}) satisfies UserDataResult;
		},
		async userDataWrite(resource, expectedRevision, content) {
			const entry = userDataEntries.get(resource);
			if (entry === undefined || !Number.isSafeInteger(expectedRevision)) {
				throw Object.freeze({
					code: "USER_DATA_INVALID",
					message: "The local user-data write request is invalid.",
				});
			}
			if (entry.revision !== expectedRevision) {
				throw Object.freeze({
					code: "USER_DATA_CONFLICT",
					message:
						"The local user-data resource changed before it could be written.",
				});
			}
			const next = { revision: entry.revision + 1, content };
			userDataEntries.set(resource, next);
			const event = Object.freeze({
				resource,
				revision: next.revision,
			}) satisfies UserDataChangedEvent;
			queueMicrotask(() => {
				for (const listener of userDataChangedListeners) listener(event);
			});
			return Object.freeze({ ...event, content }) satisfies UserDataResult;
		},
		async onUserDataChanged(listener) {
			userDataChangedListeners.add(listener);
			return () => {
				userDataChangedListeners.delete(listener);
			};
		},
		async workspaceCapabilities() {
			return workspaceCapabilities;
		},
		async workspaceSnapshot() {
			return snapshot();
		},
		workspaceReconcileWatchRoots: workspaceWatcher.reconcileRoots,
		workspaceWatch: workspaceWatcher.workspaceWatch,
		async workspacePickRoots(mode) {
			const status = scriptedPicks.shift() ?? "selected";
			if (status === "cancelled") {
				return frozenWorkspacePickResult(status, snapshot());
			}
			invalidateDeleteBatch();

			const selected = mode === "add" ? mockRoots : mockRoots.slice(0, 1);
			if (mode === "replace") {
				const replacement = selected[0]!;
				if (roots.size !== 1 || !roots.has(replacement.rootId)) {
					roots.clear();
					roots.set(replacement.rootId, replacement);
					for (const rootId of workspaceWatchStates.keys()) {
						if (rootId !== replacement.rootId) {
							workspaceWatchStates.delete(rootId);
						}
					}
					revision += 1;
				}
				recordRecent();
				return frozenWorkspacePickResult(status, snapshot());
			}

			const before = roots.size;
			for (const root of selected) {
				roots.set(root.rootId, root);
			}
			if (roots.size !== before) {
				revision += 1;
			}
			recordRecent();

			return frozenWorkspacePickResult(status, snapshot());
		},
		async workspaceOpenFiles() {
			const status = scriptedFilePicks.shift() ?? "selected";
			if (status === "cancelled") {
				return frozenWorkspaceOpenFilesResult(status, snapshot(), []);
			}
			const root = mockRoots[0]!;
			if (!roots.has(root.rootId)) {
				roots.set(root.rootId, root);
				revision += 1;
			}
			recordRecent();
			return frozenWorkspaceOpenFilesResult(status, snapshot(), [
				Object.freeze({ rootId: root.rootId, relativePath: "README.md" }),
			]);
		},
		async workspacePickSaveTarget(suggestedName) {
			const request = frozenWorkspacePickSaveTargetRequest(suggestedName);
			const outcome: BrowserMockWorkspaceSavePick =
				scriptedSavePicks.shift() ??
				Object.freeze({ status: "selected" as const });
			if (outcome.status === "cancelled") {
				return frozenWorkspacePickSaveTargetResult(
					Object.freeze({
						status: outcome.status,
						snapshot: snapshot(),
						target: null,
					}) satisfies WorkspacePickSaveTargetResult,
				);
			}

			const name = frozenWorkspacePickSaveTargetRequest(
				outcome.name ?? request.suggestedName,
			).suggestedName;
			const root = mockRoots[outcome.rootIndex ?? 0]!;
			if (!roots.has(root.rootId)) {
				roots.set(root.rootId, root);
				revision += 1;
			}
			recordRecent();
			let existingStat: ReturnType<typeof frozenWorkspaceEntryStat> | null =
				null;
			try {
				const entry = resolveEntryForRead(root.rootId, name);
				existingStat = frozenWorkspaceEntryStat(
					entry.kind,
					entry.size,
					MOCK_MTIME,
					MOCK_CTIME,
					writableVersionForEntry(root.rootId, name, entry),
				);
			} catch (error) {
				if (
					(error as { readonly code?: unknown })?.code !== "ENTRY_NOT_FOUND"
				) {
					throw error;
				}
			}
			return frozenWorkspacePickSaveTargetResult(
				Object.freeze({
					status: outcome.status,
					snapshot: snapshot(),
					target: Object.freeze({
						rootId: root.rootId,
						relativePath: name,
						existingStat,
					}),
				}) satisfies WorkspacePickSaveTargetResult,
			);
		},
		async workspaceRecentList() {
			return frozenWorkspaceRecentListResult(
				recentRevision,
				"none",
				recentEntries.map(({ entry }) => entry),
			);
		},
		async workspaceOpenRecent(recentId) {
			recentId = frozenWorkspaceRecentRequest(recentId).recentId;
			const index = recentEntries.findIndex(
				(candidate) => candidate.entry.recentId === recentId,
			);
			if (index < 0) {
				throw Object.freeze({
					code: "WORKSPACE_RECENT_NOT_FOUND",
					message: "The selected recent workspace is no longer available.",
				});
			}
			const selected = recentEntries[index]!;
			const nextRootIds = selected.roots.map(({ rootId }) => rootId);
			const currentRootIds = [...roots.keys()];
			if (
				currentRootIds.length !== nextRootIds.length ||
				currentRootIds.some(
					(rootId, rootIndex) => rootId !== nextRootIds[rootIndex],
				)
			) {
				roots.clear();
				for (const root of selected.roots) roots.set(root.rootId, root);
				revision += 1;
			}
			recordRecent();
			return snapshot();
		},
		async workspaceRemoveRecent(recentId) {
			recentId = frozenWorkspaceRecentRequest(recentId).recentId;
			const before = recentEntries.length;
			recentEntries = recentEntries.filter(
				(candidate) => candidate.entry.recentId !== recentId,
			);
			if (recentEntries.length === before) {
				throw Object.freeze({
					code: "WORKSPACE_RECENT_NOT_FOUND",
					message: "The selected recent workspace is no longer available.",
				});
			}
			recentRevision += 1;
		},
		async workspaceClearRecent() {
			recentEntries = [];
			recentRevision += 1;
		},
		async workspaceRemoveRoot(rootId) {
			if (!roots.delete(rootId)) {
				throw rootNotAuthorized();
			}
			workspaceWatchStates.delete(rootId);
			invalidateDeleteBatch();
			revision += 1;
			recordRecent();
			return snapshot();
		},
		async workspaceCloseFolder() {
			if (roots.size === 0) {
				return snapshot();
			}
			roots.clear();
			workspaceWatchStates.clear();
			invalidateDeleteBatch();
			revision += 1;
			recordRecent();
			return snapshot();
		},
		async workspaceCreateFile(rootId, relativePath) {
			createEntry(rootId, relativePath, mockFile([]));
			return frozenWorkspaceEntryStat("file", 0, 0, 0, null);
		},
		async workspaceCreateDirectory(rootId, relativePath) {
			createEntry(rootId, relativePath, mockDirectory({}));
			return frozenWorkspaceEntryStat("directory", 0, 0, 0, null);
		},
		async workspaceRename(rootId, sourcePath, targetPath) {
			renameEntry(rootId, sourcePath, targetPath);
		},
		async workspaceCopy(sourceRootId, sourcePath, targetRootId, targetPath) {
			copyEntry(sourceRootId, sourcePath, targetRootId, targetPath);
		},
		async workspaceMove(sourceRootId, sourcePath, targetRootId, targetPath) {
			return moveEntry(sourceRootId, sourcePath, targetRootId, targetPath);
		},
		async workspacePrepareDelete(entries) {
			return prepareDeleteBatch(entries);
		},
		async workspaceCancelDelete(confirmationId) {
			cancelDeleteBatch(confirmationId);
		},
		async workspaceBeginDelete(confirmationId) {
			beginDeleteBatch(confirmationId);
		},
		async workspaceCommitDeleteEntry(
			confirmationId,
			entryId,
			rootId,
			relativePath,
			recursive,
		) {
			return commitDeleteEntry(
				confirmationId,
				entryId,
				rootId,
				relativePath,
				recursive,
			);
		},
		async workspacePrepareTrash(entries) {
			return prepareTrashBatch(entries);
		},
		async workspaceCancelTrash(confirmationId) {
			cancelTrashBatch(confirmationId);
		},
		async workspaceBeginTrash(confirmationId) {
			beginTrashBatch(confirmationId);
		},
		async workspaceCommitTrashEntry(
			confirmationId,
			entryId,
			rootId,
			relativePath,
		) {
			return commitTrashEntry(confirmationId, entryId, rootId, relativePath);
		},
		async workspaceStat(rootId, relativePath) {
			const entry = resolveEntryForRead(rootId, relativePath);
			const version = writableVersionForEntry(rootId, relativePath, entry);
			return frozenWorkspaceEntryStat(
				entry.kind,
				entry.size,
				MOCK_MTIME,
				MOCK_CTIME,
				version,
			);
		},
		async workspaceReadDirectory(rootId, relativePath) {
			const entry = resolveEntryForRead(rootId, relativePath);
			if (entry.node.kind !== "directory") {
				throw entryTypeMismatch();
			}
			const root = trees.get(rootId);
			if (root === undefined) {
				throw rootNotAuthorized();
			}
			const entries = [...entry.node.entries].map(
				([name, child]): WorkspaceDirectoryEntry => {
					const childPath = [...entry.resolvedSegments, name].join("/");
					return {
						name,
						kind: classifyMockNode(root, childPath, child).kind,
					};
				},
			);
			entries.sort((left, right) =>
				compareWorkspaceEntryNames(left.name, right.name),
			);
			return frozenWorkspaceReadDirectory(entries, relativePath);
		},
		async workspaceReadFile(rootId, relativePath) {
			const entry = resolveEntryForRead(rootId, relativePath);
			if (entry.node.kind !== "file") {
				throw entryTypeMismatch();
			}
			if (entry.node.size > MAX_FILE_BYTES) {
				throw fileTooLarge();
			}
			const version = writableVersionForEntry(rootId, relativePath, entry);
			const stat = frozenWorkspaceEntryStat(
				entry.kind,
				entry.node.size,
				MOCK_MTIME,
				MOCK_CTIME,
				version,
			);
			return frozenWorkspaceReadFile(stat, entry.node.bytes);
		},
		async workspaceWriteFile(rootId, relativePath, expectedVersion, content) {
			return writeWorkspaceFile(rootId, relativePath, expectedVersion, content);
		},
		async workspacePublishFile(rootId, relativePath, content) {
			if (workspaceWriteWindowIsClosed) {
				throw workspaceWindowClosed();
			}
			if (workspaceWriteInFlight) {
				throw workspaceWriteConflict();
			}
			const request = frozenWorkspaceCreateEntryRequest(rootId, relativePath);
			if (!roots.has(request.rootId)) {
				throw rootNotAuthorized();
			}
			const frame = encodeWorkspacePublishFileRequest(
				request.rootId,
				request.relativePath,
				content,
			);
			const view = new DataView(
				frame.buffer,
				frame.byteOffset,
				frame.byteLength,
			);
			const contentLength = view.getUint32(8, false);
			const contentSnapshot = frame.slice(frame.byteLength - contentLength);

			workspaceWriteInFlight = true;
			try {
				const target = resolveCreateTarget(
					request.rootId,
					request.relativePath,
				);
				if (target.parent.entries.has(target.name)) {
					throw entryAlreadyExists();
				}
				createEntry(
					request.rootId,
					request.relativePath,
					mockFile(contentSnapshot),
				);
				const entry = resolveEntryForRead(request.rootId, request.relativePath);
				const version = writableVersionForEntry(
					request.rootId,
					request.relativePath,
					entry,
				);
				if (version === null) {
					return workspaceWriteResponseUnavailable();
				}
				return frozenWorkspacePublishFileResult(
					Object.freeze({
						status: "written",
						stat: frozenWorkspaceEntryStat(
							"file",
							contentLength,
							MOCK_MTIME,
							MOCK_CTIME,
							version,
						),
					}),
					contentLength,
				);
			} finally {
				finishWorkspaceWriteGate();
			}
		},
		async workspaceSearchFiles(roots_, filePattern, excludeGlobs, maxResults) {
			const request = frozenWorkspaceSearchFilesRequest(
				roots_,
				filePattern,
				excludeGlobs,
				maxResults,
			);
			return searchWorkspaceFiles(request);
		},
		async workspaceSearchTextStart(candidate) {
			const request = frozenWorkspaceSearchTextStartRequest(
				candidate.roots,
				candidate.pattern,
				candidate.isRegExp,
				candidate.isCaseSensitive,
				candidate.isWordMatch,
				candidate.excludeGlobs,
				candidate.maxResults,
				candidate.maxFileSize,
			);
			// A new start always supersedes whatever this window already had,
			// active or lingering-done — mirrors the Rust service's contract.
			const { pending, limitHit, skippedBinary, skippedOversize } =
				searchWorkspaceTextMatches(request);
			const searchId = nextTextSearchId();
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
			return decodeWorkspaceSearchTextStartResult({ searchId });
		},
		async workspaceSearchTextPoll(searchId, cursor) {
			if (
				activeTextSearch === undefined ||
				activeTextSearch.searchId !== searchId
			) {
				throw searchNotFound();
			}
			const search = activeTextSearch;
			if (cursor !== search.deliveredCursor) {
				throw invalidSearchRequest();
			}
			const delivered = search.pending.splice(
				0,
				MOCK_TEXT_SEARCH_BATCHES_PER_POLL,
			);
			search.deliveredCursor += delivered.length;
			const done = search.pending.length === 0;
			if (!done) {
				emitTextSearchWake(searchId);
			}
			return frozenWorkspaceSearchTextPollResult(
				delivered,
				search.deliveredCursor,
				done,
				search.limitHit,
				{ binary: search.skippedBinary, oversize: search.skippedOversize },
			);
		},
		async workspaceSearchTextCancel(searchId) {
			if (
				activeTextSearch === undefined ||
				activeTextSearch.searchId !== searchId
			) {
				throw searchNotFound();
			}
			activeTextSearch = undefined;
		},
		workspaceSearchTextWatch(listener) {
			textSearchWakeListeners.add(listener);
			return () => {
				textSearchWakeListeners.delete(listener);
			};
		},
		async workspaceSearchExpandReplacements(
			pattern,
			isCaseSensitive,
			isWordMatch,
			replacementTemplate,
			expectedTexts,
		) {
			const request = frozenWorkspaceSearchExpandReplacementsRequest(
				pattern,
				isCaseSensitive,
				isWordMatch,
				replacementTemplate,
				expectedTexts,
			);
			const items = expandWorkspaceSearchReplacements(request);
			return frozenWorkspaceSearchExpandReplacementsResult(items);
		},
		async backupWrite(rootId, key, bytes) {
			if (!roots.has(rootId)) {
				throw backupUnavailable();
			}
			const validated = frozenBackupWriteInputs(rootId, key, bytes);
			backupEntries.set(
				backupMapKey(validated.rootId, validated.key),
				Object.freeze({
					rootId: validated.rootId,
					key: validated.key,
					bytes: validated.content,
				}),
			);
		},
		async backupReadAll(): Promise<readonly BackupEntry[]> {
			if (roots.size === 0) {
				throw backupUnavailable();
			}
			const entries = [...backupEntries.values()]
				.filter(({ rootId }) => roots.has(rootId))
				.sort((left, right) =>
					left.rootId < right.rootId
						? -1
						: left.rootId > right.rootId
							? 1
							: left.key < right.key
								? -1
								: left.key > right.key
									? 1
									: 0,
				)
				.map(({ rootId, key, bytes }): BackupEntry =>
					Object.freeze({ rootId, key, bytes: bytes.slice() }),
				);
			return Object.freeze(entries);
		},
		async backupDiscard(rootId, key) {
			if (!roots.has(rootId)) {
				throw backupUnavailable();
			}
			const request = frozenBackupDiscardRequest(rootId, key);
			backupEntries.delete(backupMapKey(request.rootId, request.key));
		},
		async backupDiscardAll() {
			if (roots.size === 0) {
				throw backupUnavailable();
			}
			for (const [mapKey, entry] of backupEntries) {
				if (roots.has(entry.rootId)) {
					backupEntries.delete(mapKey);
				}
			}
		},
		async scratchCreate() {
			const tail = nextScratchOrdinal.toString(16).padStart(12, "0");
			nextScratchOrdinal += 1;
			const scratchId = `00000000-0000-4000-8000-${tail}`;
			return Object.freeze({ scratchId });
		},
		async scratchWrite(scratchId, bytes) {
			const validated = frozenScratchWriteInputs(scratchId, bytes);
			scratchEntries.set(validated.scratchId, validated.content);
		},
		async scratchReadAll() {
			return Object.freeze(
				[...scratchEntries]
					.sort(([left], [right]) => left.localeCompare(right))
					.map(([scratchId, bytes]) =>
						Object.freeze({ scratchId, bytes: bytes.slice() }),
					),
			);
		},
		async scratchDiscard(scratchId) {
			const request = frozenScratchDiscardRequest(scratchId);
			scratchEntries.delete(request.scratchId);
		},
		async scratchDiscardAll() {
			scratchEntries.clear();
		},
		async themeImportVsix() {
			return themeImportFromScript();
		},
		async themeImportDirectory() {
			return themeImportFromScript();
		},
		async themeList() {
			const packages = [...themePackages.values()].sort((left, right) =>
				left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
			);
			return Object.freeze({ packages: Object.freeze(packages), skipped: 0 });
		},
		async themeReadResource(packageId, relativePath) {
			const summary = themePackages.get(packageId);
			const resources = themeResourceContents.get(packageId);
			if (
				summary === undefined ||
				resources === undefined ||
				!summary.resources.includes(relativePath)
			) {
				throw themeResourceNotFound();
			}
			const content = resources.get(relativePath);
			if (content === undefined) {
				throw themeResourceNotFound();
			}
			return new TextEncoder().encode(content);
		},
		async themeRemove(packageId) {
			// Idempotent, matching the Rust service: removing an unknown or
			// already-removed id is a plain success.
			themePackages.delete(packageId);
			themeResourceContents.delete(packageId);
		},
		async themeGetSelection() {
			return Object.freeze({
				themeId: themeSelection,
				fileIconThemeId: fileIconThemeSelection,
				productIconThemeId: productIconThemeSelection,
			});
		},
		async themeSetSelection(themeId) {
			themeSelection = themeId;
		},
		async themeSetFileIconThemeSelection(fileIconThemeId) {
			fileIconThemeSelection = fileIconThemeId;
		},
		async themeSetProductIconThemeSelection(productIconThemeId) {
			productIconThemeSelection = productIconThemeId;
		},
		async terminalProfiles() {
			frozenTerminalProfilesRequest();
			return decodeTerminalProfilesResult({
				profiles: [
					{ id: "systemDefault", label: "zsh (System Default)" },
					{ id: "zsh", label: "zsh" },
					{ id: "bash", label: "bash" },
				],
				defaultProfileId: "systemDefault",
			});
		},
		async terminalStart(rootId, profileId, cwd, cols, rows) {
			const request = frozenTerminalStartRequest(
				rootId,
				profileId,
				cwd,
				cols,
				rows,
			);
			if (roots.size === 0 || !terminalTrusted) {
				throw terminalNotTrusted();
			}
			if (!roots.has(request.rootId)) {
				throw rootNotAuthorized();
			}
			if (
				!new Set(["systemDefault", "zsh", "bash", "sh"]).has(request.profileId)
			) {
				throw Object.freeze({
					code: "TERMINAL_PROFILE_INVALID",
					message:
						"The requested terminal profile is not available on this computer.",
				});
			}
			const session = startMockTerminalSession(request.cols, request.rows);
			// Mirrors `terminal::shell_integration::plan_for_shell`'s own
			// family split closely enough for frontend-only tests: zsh/bash
			// (and `systemDefault`, standing in for whichever real shell it
			// would resolve to) are audited families → `injected`; every
			// other accepted profile id degrades to `unsupportedShell` —
			// never silently reported as `injected`.
			const shellIntegration = new Set(["systemDefault", "zsh", "bash"]).has(
				request.profileId,
			)
				? "injected"
				: "unsupportedShell";
			return decodeTerminalStartResult({
				sessionId: session.sessionId,
				shellIntegration,
			});
		},
		async terminalInputText(sessionId, text) {
			const request = frozenTerminalInputTextRequest(sessionId, text);
			const session = getMockTerminalSession(request.sessionId);
			if (session.exited) {
				throw terminalIoFailed();
			}
			// This minimal echo mock reflects written text straight back as
			// output — see `BrowserMockTerminalSessionController`'s doc
			// comment for why this is not a real shell's own echo decision.
			pushMockTerminalOutput(session, request.text);
		},
		async terminalInputKey(sessionId, action, key, mods, utf8) {
			const request = frozenTerminalInputKeyRequest(
				sessionId,
				action,
				key,
				mods,
				utf8,
			);
			const session = getMockTerminalSession(request.sessionId);
			if (session.exited) {
				throw terminalIoFailed();
			}
			// This mock does not replicate `libghostty-vt`'s key encoding
			// matrix (see `BrowserMockTerminalSessionController`'s doc
			// comment) — it only echoes the key event's own `utf8` text, if
			// any, approximating how a printable character key would look
			// once round-tripped through a real shell.
			if (request.utf8 !== null) {
				pushMockTerminalOutput(session, request.utf8);
			}
		},
		async terminalFocus(sessionId, focused) {
			const request = frozenTerminalFocusRequest(sessionId, focused);
			getMockTerminalSession(request.sessionId);
			// Always a silent no-op: this mock never enables DEC 1004,
			// matching a real terminal's default —see
			// `TerminalModesSnapshot::focus_reporting_enabled`'s doc.
		},
		async terminalResize(sessionId, cols, rows) {
			const request = frozenTerminalResizeRequest(sessionId, cols, rows);
			const session = getMockTerminalSession(request.sessionId);
			resizeMockTerminalSession(session, request.cols, request.rows);
		},
		async terminalAck(sessionId, sequence) {
			const request = frozenTerminalAckRequest(sessionId, sequence);
			const session = getMockTerminalSession(request.sessionId);
			ackMockTerminalSession(session, request.sequence);
		},
		async terminalScrollback(sessionId, start, count) {
			const request = frozenTerminalScrollbackRequest(sessionId, start, count);
			getMockTerminalSession(request.sessionId);
			// This mock keeps no scrollback history — a single echo row only
			// (see `BrowserMockTerminalSessionController`'s doc comment).
			return decodeTerminalScrollbackResult({ rows: [] });
		},
		async terminalKill(sessionId, immediate) {
			const request = frozenTerminalKillRequest(sessionId, immediate);
			const session = getMockTerminalSession(request.sessionId);
			finishMockTerminalSession(session, MOCK_TERMINAL_KILLED_EXIT_CODE);
			terminalSessions.delete(request.sessionId);
		},
		async terminalOpenExternalLink(url) {
			const request = frozenTerminalOpenExternalLinkRequest(url);
			options.onTerminalOpenExternalLinkForTest?.(request.url);
		},
		async terminalLifecycleMarker() {
			// `F190` S6: this whole mock bridge is a fresh, purely in-memory
			// object recreated by every `createBrowserMockBridge` call (see
			// this file's own module doc) — there is no real "previous run"
			// for it to have survived a reload or crash *from*, unlike the
			// real Rust-persisted marker (`terminal::service::
			// TerminalLifecycleMarkerStore`) or the dedicated
			// `sessionStorage`-backed fake transport
			// `tests/browser/workspace.spec.ts`'s own `installNativeIpcMock`
			// uses to exercise that real behavior. `0` (no notice) is
			// therefore always the honest answer here.
			frozenTerminalLifecycleMarkerRequest();
			return decodeTerminalLifecycleMarkerResult({ nonRestorableCount: 0 });
		},
		terminalWatchData(listener) {
			terminalDataListeners.add(listener);
			return () => {
				terminalDataListeners.delete(listener);
			};
		},
		terminalWatchExit(listener) {
			terminalExitListeners.add(listener);
			return () => {
				terminalExitListeners.delete(listener);
			};
		},
		async workspaceTrustState() {
			return decodeWorkspaceTrustState({
				trusted: roots.size === 0 ? false : terminalTrusted,
			});
		},
		async workspaceTrustGrant() {
			if (roots.size === 0) {
				throw trustUnavailable();
			}
			terminalTrusted = true;
			return decodeWorkspaceTrustState({ trusted: true });
		},
		async workspaceTrustRevoke() {
			if (roots.size === 0) {
				throw trustUnavailable();
			}
			terminalTrusted = false;
		},
		async gitStatus(rootId_) {
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			return Object.freeze({
				branch: gitBranch,
				entries: Object.freeze(gitEntries.map((entry) => ({ ...entry }))),
			});
		},
		async gitDiffFiles(cached_, rootId_) {
			const request = frozenGitDiffFilesRequest(cached_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			return request.cached
				? (gitFixture.diffFiles?.cached ?? defaultGitDiffFiles)
				: (gitFixture.diffFiles?.worktree ?? defaultGitDiffFiles);
		},
		async gitShowBlob(rev_, path_, rootId_) {
			const request = frozenGitShowBlobRequest(rev_, path_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			const content = gitBlobs.get(request.path)?.[request.rev];
			return frozenGitShowBlobResult(
				content === undefined ? null : new TextEncoder().encode(content),
			);
		},
		async gitStagePaths(paths_, rootId_) {
			const request = frozenGitStagePathsRequest(paths_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			for (const path of request.paths) {
				gitStageOnePath(path, true);
			}
		},
		async gitUnstagePaths(paths_, rootId_) {
			const request = frozenGitUnstagePathsRequest(paths_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			for (const path of request.paths) {
				gitUnstageOnePath(path);
			}
		},
		async gitStageBlob(path_, content_, rootId_) {
			const request = frozenGitStageBlobRequest(path_, content_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			gitStageOnePath(request.path, false);
		},
		async gitCommit(message_, amend_, rootId_) {
			const request = frozenGitCommitRequest(message_, amend_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			if (!request.amend && !gitHasStagedChanges()) {
				throw gitCommitNothingToCommit();
			}
			gitCommitStagedEntries();
		},
		async gitDiscardPaths(paths_, rootId_) {
			const request = frozenGitDiscardPathsRequest(paths_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			// All-or-nothing, mirroring real `git checkout -q --`: every path
			// must resolve before any of them are touched.
			if (!request.paths.every((path) => gitPathIsDiscardable(path))) {
				throw gitDiscardFailed();
			}
			for (const path of request.paths) {
				gitDiscardOnePath(path);
			}
		},
		async gitNetworkPreview(
			operation_,
			rootId_,
		): Promise<GitNetworkPreviewResult> {
			const request = frozenGitNetworkPreviewRequest(operation_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			if (gitNetworkUpstream === null) {
				if (request.operation === "fetch") {
					return Object.freeze({
						upstream: null,
						ahead: null,
						behind: null,
					});
				}
				throw gitNetworkNoUpstream();
			}
			return Object.freeze({
				upstream: gitNetworkUpstream,
				ahead: gitNetworkAhead,
				behind: gitNetworkBehind,
			});
		},
		async gitFetch(rootId_) {
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			// A real fetch only updates the remote-tracking ref, never the
			// local branch/ahead-behind-vs-HEAD numbers this simulation
			// tracks — see `BrowserMockGitNetworkFixtureForTest`'s own doc
			// comment for why this mock does not model a separate remote
			// state to fetch new data from.
		},
		async gitPull(rootId_) {
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			if (gitNetworkUpstream === null) {
				throw gitNetworkNoUpstream();
			}
			gitNetworkBehind = 0;
		},
		async gitPush(force_, rootId_) {
			const request = frozenGitPushRequest(force_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			if (gitNetworkUpstream === null) {
				throw gitNetworkNoUpstream();
			}
			if (request.force) {
				if (gitNetworkFixture.forcePushRejectedForTest === true) {
					throw gitPushRejected();
				}
			} else if (gitNetworkBehind > 0) {
				throw gitPushRejected();
			}
			gitNetworkAhead = 0;
		},
		async gitNetworkCancel(rootId_) {
			if (rootId_ === undefined) {
				if (roots.size !== 1) {
					throw commandError(
						"GIT_ROOT_REQUIRED",
						"Select a workspace root before running a Git operation.",
					);
				}
			} else {
				frozenGitRootId(rootId_);
			}
			// This mock resolves every network call synchronously-ish (no real
			// long-running subprocess to interrupt), so there is never
			// anything in flight to actually cancel — a harmless no-op,
			// matching the real bridge method's own idempotent contract.
		},
		async gitBlameFile(path_, range_, rootId_) {
			const request = frozenGitBlameFileRequest(path_, range_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			const fixture = gitBlameFixtures.get(request.path) ?? defaultGitBlameFile;
			if (request.range === null) {
				return fixture;
			}
			const { start, end } = request.range;
			const entries: GitBlameLineEntry[] = fixture.entries.filter(
				(entry) => entry.finalLine >= start && entry.finalLine <= end,
			);
			const commitShas = new Set(entries.map((entry) => entry.commitSha));
			const commits: Record<string, GitBlameCommitHeader> = {};
			for (const [sha, header] of Object.entries(fixture.commits)) {
				if (commitShas.has(sha)) {
					commits[sha] = header;
				}
			}
			return Object.freeze({ entries: Object.freeze(entries), commits });
		},
		async gitBlameCommitMessages(shas_, rootId_) {
			const request = frozenGitBlameCommitMessagesRequest(shas_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			const messages: Record<string, string> = {};
			for (const sha of request.shas) {
				const message = gitBlameCommitMessages.get(sha);
				if (message !== undefined) {
					messages[sha] = message;
				}
			}
			return Object.freeze({ messages });
		},
		async gitFileHistory(path_, rootId_) {
			const request = frozenGitFileHistoryRequest(path_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			return gitFileHistoryFixtures.get(request.path) ?? defaultGitHistoryList;
		},
		async gitLineHistoryList(path_, range_, rootId_) {
			const request = frozenGitLineHistoryListRequest(path_, range_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			// This mock has no real per-line git history to slice by range — the
			// seeded fixture (keyed by path only) is returned regardless of the
			// requested range, exactly like `gitFileHistory`'s own "one fixture
			// per path" simplicity — see `BrowserMockGitFixtureForTest.
			// lineHistoryList`'s own doc comment.
			return (
				gitLineHistoryListFixtures.get(request.path) ?? defaultGitHistoryList
			);
		},
		async gitLineHistoryDetail(path_, range_, skip_, expectedSha_, rootId_) {
			const request = frozenGitLineHistoryDetailRequest(
				path_,
				range_,
				skip_,
				expectedSha_,
			);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			const list =
				gitLineHistoryListFixtures.get(request.path) ?? defaultGitHistoryList;
			const entry: GitHistoryEntry | undefined = list.entries[request.skip];
			if (entry === undefined) {
				throw commandError(
					"GIT_LINE_HISTORY_DETAIL_NOT_FOUND",
					"No commit exists at the requested position in this line's history.",
				);
			}
			if (entry.sha !== request.expectedSha) {
				throw commandError(
					"GIT_LINE_HISTORY_DETAIL_STALE_INDEX",
					"The line's history has changed since it was listed; refresh and try again.",
				);
			}
			const seeded = gitLineHistoryDetailFixtures.get(entry.sha);
			if (seeded !== undefined) {
				return seeded;
			}
			return Object.freeze({
				sha: entry.sha,
				diffText: `commit ${entry.sha}\n\n    ${entry.message}\n`,
			});
		},
		async gitShowCommit(sha_, rootId_) {
			const request = frozenGitShowCommitRequest(sha_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			return (
				gitShowCommitFixtures.get(request.sha) ??
				Object.freeze({
					sha: request.sha,
					parentSha: null,
					files: Object.freeze([]),
				})
			);
		},
		async gitShowCommitBlob(sha_, path_, rootId_) {
			const request = frozenGitShowCommitBlobRequest(sha_, path_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			const content = gitCommitBlobs.get(request.sha)?.[request.path];
			return frozenGitShowBlobResult(
				content === undefined ? null : new TextEncoder().encode(content),
			);
		},
		async gitLogGraph(maxCount_, rootId_) {
			// This mock has no real commit history to walk/cap by `maxCount` —
			// the seeded fixture (or the empty default) is returned as-is,
			// exactly like `gitFileHistory`'s own "one fixture regardless of
			// the requested range" simplicity — see `BrowserMockGitFixtureForTest.
			// graphForTest`'s own doc comment.
			frozenGitLogGraphRequest(maxCount_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			return gitGraphResult;
		},
		async gitRefsList(rootId_) {
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			return gitRefsListSnapshot();
		},
		async gitRemotesList(rootId_) {
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			return gitRemotesListSnapshot();
		},
		async gitReflogList(rootId_) {
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			return gitReflogListResult;
		},
		async gitContributorsList(rootId_) {
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			return gitContributorsListResult;
		},
		async gitBranchCreate(name_, targetSha_, rootId_) {
			const request = frozenGitBranchCreateRequest(name_, targetSha_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			if (gitLocalBranch(request.name) !== undefined) {
				throw gitManagementError(
					"GIT_BRANCH_ALREADY_EXISTS",
					"A Git branch with that name already exists.",
				);
			}
			gitRefEntries.push({
				kind: "branch",
				fullName: `refs/heads/${request.name}`,
				shortName: request.name,
				targetSha: request.targetSha,
				isAnnotatedTag: false,
				peeledSha: null,
				upstream: null,
				isHead: false,
			});
		},
		async gitBranchSwitch(name_, rootId_) {
			const request = frozenGitBranchSwitchRequest(name_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			const branch = gitLocalBranch(request.name);
			if (branch === undefined) {
				throw gitManagementError(
					"GIT_BRANCH_NOT_FOUND",
					"The requested Git branch does not exist.",
				);
			}
			gitRefEntries = gitRefEntries.map((entry) =>
				entry.kind === "branch"
					? { ...entry, isHead: entry.shortName === request.name }
					: entry,
			);
			const upstream = shortUpstream(branch.upstream);
			gitBranch = {
				oid: branch.targetSha,
				head: request.name,
				upstream:
					upstream === null ? null : { name: upstream, ahead: 0, behind: 0 },
			};
			gitNetworkUpstream = upstream;
		},
		async gitBranchRename(oldName_, newName_, rootId_) {
			const request = frozenGitBranchRenameRequest(oldName_, newName_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			const branch = gitLocalBranch(request.oldName);
			if (branch === undefined) {
				throw gitManagementError(
					"GIT_BRANCH_NOT_FOUND",
					"The requested Git branch does not exist.",
				);
			}
			if (gitLocalBranch(request.newName) !== undefined) {
				throw gitManagementError(
					"GIT_BRANCH_ALREADY_EXISTS",
					"A Git branch with that name already exists.",
				);
			}
			gitRefEntries = gitRefEntries.map((entry) =>
				entry === branch
					? {
							...entry,
							fullName: `refs/heads/${request.newName}`,
							shortName: request.newName,
						}
					: entry,
			);
			if (gitBranch.head === request.oldName) {
				gitBranch = { ...gitBranch, head: request.newName };
			}
			if (gitUnmergedBranches.delete(request.oldName)) {
				gitUnmergedBranches.add(request.newName);
			}
		},
		async gitBranchDelete(name_, force_, rootId_) {
			const request = frozenGitBranchDeleteRequest(name_, force_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			const branch = gitLocalBranch(request.name);
			if (branch === undefined) {
				throw gitManagementError(
					"GIT_BRANCH_NOT_FOUND",
					"The requested Git branch does not exist.",
				);
			}
			if (branch.isHead || gitBranch.head === request.name) {
				throw gitManagementError(
					"GIT_BRANCH_IS_CURRENT",
					"The currently checked-out Git branch cannot be deleted.",
				);
			}
			if (!request.force && gitUnmergedBranches.has(request.name)) {
				return "needsForce" satisfies GitBranchDeleteOutcome;
			}
			gitRefEntries = gitRefEntries.filter((entry) => entry !== branch);
			gitUnmergedBranches.delete(request.name);
			return "deleted" satisfies GitBranchDeleteOutcome;
		},
		async gitTagCreate(name_, targetSha_, message_, rootId_) {
			const request = frozenGitTagCreateRequest(name_, targetSha_, message_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			if (gitTag(request.name) !== undefined) {
				throw gitManagementError(
					"GIT_TAG_ALREADY_EXISTS",
					"A Git tag with that name already exists.",
				);
			}
			gitRefEntries.push({
				kind: "tag",
				fullName: `refs/tags/${request.name}`,
				shortName: request.name,
				targetSha: request.targetSha,
				isAnnotatedTag: request.message !== null,
				peeledSha: request.message === null ? null : request.targetSha,
				upstream: null,
				isHead: false,
			});
		},
		async gitTagDelete(name_, rootId_) {
			const request = frozenGitTagDeleteRequest(name_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			const tag = gitTag(request.name);
			if (tag === undefined) {
				throw gitManagementError(
					"GIT_TAG_NOT_FOUND",
					"The requested Git tag does not exist.",
				);
			}
			gitRefEntries = gitRefEntries.filter((entry) => entry !== tag);
		},
		async gitRemoteAdd(name_, url_, rootId_) {
			const request = frozenGitRemoteAddRequest(name_, url_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			if (gitRemote(request.name) !== undefined) {
				throw gitManagementError(
					"GIT_REMOTE_ALREADY_EXISTS",
					"A Git remote with that name already exists.",
				);
			}
			gitRemoteEntries.push({
				name: request.name,
				fetchUrls: [redactGitRemoteUrlForMock(request.url)],
				pushUrls: [],
			});
		},
		async gitRemoteRename(oldName_, newName_, rootId_) {
			const request = frozenGitRemoteRenameRequest(oldName_, newName_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			const remote = gitRemote(request.oldName);
			if (remote === undefined) {
				throw gitManagementError(
					"GIT_REMOTE_NOT_FOUND",
					"The requested Git remote does not exist.",
				);
			}
			if (gitRemote(request.newName) !== undefined) {
				throw gitManagementError(
					"GIT_REMOTE_ALREADY_EXISTS",
					"A Git remote with that name already exists.",
				);
			}
			gitRemoteEntries = gitRemoteEntries.map((entry) =>
				entry === remote ? { ...entry, name: request.newName } : entry,
			);
			const oldShortPrefix = `${request.oldName}/`;
			const oldFullPrefix = `refs/remotes/${request.oldName}/`;
			gitRefEntries = gitRefEntries.map((entry) => {
				if (
					entry.kind === "remoteBranch" &&
					entry.shortName.startsWith(oldShortPrefix)
				) {
					const suffix = entry.shortName.slice(oldShortPrefix.length);
					return {
						...entry,
						shortName: `${request.newName}/${suffix}`,
						fullName: `refs/remotes/${request.newName}/${suffix}`,
					};
				}
				if (entry.upstream?.startsWith(oldFullPrefix) === true) {
					return {
						...entry,
						upstream: `refs/remotes/${request.newName}/${entry.upstream.slice(oldFullPrefix.length)}`,
					};
				}
				return entry;
			});
			if (gitNetworkUpstream?.startsWith(oldShortPrefix) === true) {
				gitNetworkUpstream = `${request.newName}/${gitNetworkUpstream.slice(oldShortPrefix.length)}`;
			}
			if (gitBranch.upstream?.name.startsWith(oldShortPrefix) === true) {
				gitBranch = {
					...gitBranch,
					upstream: {
						...gitBranch.upstream,
						name: `${request.newName}/${gitBranch.upstream.name.slice(oldShortPrefix.length)}`,
					},
				};
			}
		},
		async gitRemoteSetUrl(name_, kind_, url_, rootId_) {
			const request = frozenGitRemoteSetUrlRequest(name_, kind_, url_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			const remote = gitRemote(request.name);
			if (remote === undefined) {
				throw gitManagementError(
					"GIT_REMOTE_NOT_FOUND",
					"The requested Git remote does not exist.",
				);
			}
			const displayUrl = redactGitRemoteUrlForMock(request.url);
			gitRemoteEntries = gitRemoteEntries.map((entry) =>
				entry === remote
					? {
							...entry,
							fetchUrls:
								request.kind === "fetch" ? [displayUrl] : entry.fetchUrls,
							pushUrls: request.kind === "push" ? [displayUrl] : entry.pushUrls,
						}
					: entry,
			);
		},
		async gitRemoteRemove(name_, rootId_) {
			const request = frozenGitRemoteRemoveRequest(name_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			const remote = gitRemote(request.name);
			if (remote === undefined) {
				throw gitManagementError(
					"GIT_REMOTE_NOT_FOUND",
					"The requested Git remote does not exist.",
				);
			}
			gitRemoteEntries = gitRemoteEntries.filter((entry) => entry !== remote);
			const shortPrefix = `${request.name}/`;
			const fullPrefix = `refs/remotes/${request.name}/`;
			gitRefEntries = gitRefEntries
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
			if (gitNetworkUpstream?.startsWith(shortPrefix) === true) {
				gitNetworkUpstream = null;
			}
			if (gitBranch.upstream?.name.startsWith(shortPrefix) === true) {
				gitBranch = { ...gitBranch, upstream: null };
			}
		},
		async gitUpstreamSet(branch_, upstream_, rootId_) {
			const request = frozenGitUpstreamSetRequest(branch_, upstream_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			const branch = gitLocalBranch(request.branch);
			if (branch === undefined) {
				throw gitManagementError(
					"GIT_BRANCH_NOT_FOUND",
					"The requested Git branch does not exist.",
				);
			}
			const remoteBranch = gitRefEntries.find(
				(entry) =>
					entry.kind === "remoteBranch" && entry.shortName === request.upstream,
			);
			const remoteName = request.upstream.slice(
				0,
				request.upstream.indexOf("/"),
			);
			if (remoteBranch === undefined || gitRemote(remoteName) === undefined) {
				throw gitManagementError(
					"GIT_UPSTREAM_NOT_FOUND",
					"The requested remote-tracking branch does not exist.",
				);
			}
			gitRefEntries = gitRefEntries.map((entry) =>
				entry === branch
					? { ...entry, upstream: `refs/remotes/${request.upstream}` }
					: entry,
			);
			if (gitBranch.head === request.branch) {
				gitNetworkUpstream = request.upstream;
				gitBranch = {
					...gitBranch,
					upstream: { name: request.upstream, ahead: 0, behind: 0 },
				};
			}
		},
		async gitUpstreamUnset(branch_, rootId_) {
			const request = frozenGitUpstreamUnsetRequest(branch_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			const branch = gitLocalBranch(request.branch);
			if (branch === undefined) {
				throw gitManagementError(
					"GIT_BRANCH_NOT_FOUND",
					"The requested Git branch does not exist.",
				);
			}
			if (branch.upstream === null) {
				throw gitManagementError(
					"GIT_UPSTREAM_NOT_CONFIGURED",
					"The requested local branch has no configured upstream.",
				);
			}
			gitRefEntries = gitRefEntries.map((entry) =>
				entry === branch ? { ...entry, upstream: null } : entry,
			);
			if (gitBranch.head === request.branch) {
				gitNetworkUpstream = null;
				gitBranch = { ...gitBranch, upstream: null };
			}
		},
		async gitHistoryState(rootId_) {
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			return gitHistoryStateSnapshot();
		},
		async gitHistoryPreview(operation_, targetSha_, rootId_) {
			const request = frozenGitHistoryPreviewRequest(operation_, targetSha_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			return gitHistoryPreviewSnapshot(request.operation, request.targetSha);
		},
		async gitMerge(targetSha_, previewToken_, rootId_) {
			const request = frozenGitMergeRequest(targetSha_, previewToken_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			return gitHistoryExecute(
				"merge",
				request.targetSha,
				request.previewToken,
			);
		},
		async gitRebase(targetSha_, previewToken_, rootId_) {
			const request = frozenGitRebaseRequest(targetSha_, previewToken_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			return gitHistoryExecute(
				"rebase",
				request.targetSha,
				request.previewToken,
			);
		},
		async gitCherryPick(targetSha_, previewToken_, rootId_) {
			const request = frozenGitCherryPickRequest(targetSha_, previewToken_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			return gitHistoryExecute(
				"cherryPick",
				request.targetSha,
				request.previewToken,
			);
		},
		async gitRevert(targetSha_, previewToken_, rootId_) {
			const request = frozenGitRevertRequest(targetSha_, previewToken_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			return gitHistoryExecute(
				"revert",
				request.targetSha,
				request.previewToken,
			);
		},
		async gitReset(targetSha_, mode_, previewToken_, rootId_) {
			const request = frozenGitResetRequest(targetSha_, mode_, previewToken_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			const operation = {
				soft: "resetSoft",
				mixed: "resetMixed",
				hard: "resetHard",
			}[request.mode] as GitHistoryOperation;
			return gitHistoryExecute(
				operation,
				request.targetSha,
				request.previewToken,
			);
		},
		async gitHistoryContinue(kind_, rootId_) {
			const request = frozenGitHistoryContinueRequest(kind_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			if (gitHistorySequencer?.kind !== request.kind) {
				throw commandError(
					"GIT_HISTORY_OPERATION_KIND_CHANGED",
					"The in-progress Git operation changed. Refresh its state before continuing.",
				);
			}
			gitHistorySequencer = null;
			gitCommitCounter += 1;
			gitBranch = {
				...gitBranch,
				oid: gitCommitCounter.toString(16).padStart(40, "0"),
			};
			return Object.freeze({
				kind: "completed",
				state: gitHistoryStateSnapshot(),
			});
		},
		async gitHistoryAbort(kind_, rootId_) {
			const request = frozenGitHistoryAbortRequest(kind_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			if (gitHistorySequencer?.kind !== request.kind) {
				throw commandError(
					"GIT_HISTORY_OPERATION_KIND_CHANGED",
					"The in-progress Git operation changed. Refresh its state before continuing.",
				);
			}
			gitHistorySequencer = null;
			return Object.freeze({
				kind: "completed",
				state: gitHistoryStateSnapshot(),
			});
		},
		async gitHistoryCancel(rootId_) {
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
		},
		async gitStashList(rootId_) {
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			return gitStashListSnapshot();
		},
		async gitStashShow(sha_, rootId_) {
			const request = frozenGitStashShowRequest(sha_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			if (!gitStashEntries.some((entry) => entry.sha === request.sha)) {
				throw gitStashNotFound();
			}
			return (
				gitStashShowFixtures.get(request.sha) ??
				Object.freeze({
					sha: request.sha,
					parentSha: null,
					files: Object.freeze([]),
				})
			);
		},
		async gitStashPush(message_, includeUntracked_, rootId_) {
			const request = frozenGitStashPushRequest(message_, includeUntracked_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			gitStashCounter += 1;
			const sha = `f0${gitStashCounter.toString(16).padStart(38, "0")}`;
			gitStashEntries.unshift({
				index: 0,
				sha,
				committerTime: Math.floor(Date.now() / 1000),
				message: request.message,
			});
			return "created";
		},
		async gitStashApply(sha_, useIndex_, rootId_) {
			const request = frozenGitStashApplyRequest(sha_, useIndex_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			if (!gitStashEntries.some((entry) => entry.sha === request.sha)) {
				throw gitStashNotFound();
			}
			const conflictedPaths = gitStashConflictFixtures.get(request.sha);
			if (conflictedPaths !== undefined) {
				return Object.freeze({
					kind: "conflict" as const,
					conflictedPaths,
				});
			}
			return Object.freeze({ kind: "applied" as const });
		},
		async gitStashPop(sha_, useIndex_, rootId_) {
			const request = frozenGitStashPopRequest(sha_, useIndex_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			const index = gitStashEntries.findIndex(
				(entry) => entry.sha === request.expectedSha,
			);
			if (index === -1) {
				throw gitStashNotFound();
			}
			const conflictedPaths = gitStashConflictFixtures.get(request.expectedSha);
			if (conflictedPaths !== undefined) {
				return Object.freeze({
					kind: "conflict" as const,
					conflictedPaths,
				});
			}
			gitStashEntries.splice(index, 1);
			return Object.freeze({ kind: "applied" as const });
		},
		async gitStashDrop(sha_, rootId_) {
			const request = frozenGitStashDropRequest(sha_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			const index = gitStashEntries.findIndex(
				(entry) => entry.sha === request.expectedSha,
			);
			if (index === -1) {
				throw gitStashNotFound();
			}
			gitStashEntries.splice(index, 1);
		},
		async gitWorktreeList(rootId_) {
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			return gitWorktreeListSnapshot();
		},
		async gitWorktreeAdd(childSegment_, detach_, commitIsh_, rootId_) {
			const request = frozenGitWorktreeAddRequest(
				childSegment_,
				detach_,
				commitIsh_,
			);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			if (gitFixture.worktreeAddCancelledForTest === true) {
				return Object.freeze({ kind: "pickerCancelled" as const });
			}
			gitWorktreeCounter += 1;
			const sha = `a0${gitWorktreeCounter.toString(16).padStart(38, "0")}`;
			const path = `/workspace-worktrees/${request.childSegment}`;
			gitWorktreeEntries.push({
				path,
				headSha: sha,
				headState: request.detach
					? { kind: "detached" as const }
					: {
							kind: "branch" as const,
							refName: `refs/heads/${request.commitIsh ?? request.childSegment}`,
						},
				lockReason: null,
				prunableReason: null,
				isMain: false,
			});
			return Object.freeze({ kind: "added" as const, path });
		},
		async gitWorktreeRemove(path_, force_, rootId_) {
			const request = frozenGitWorktreeRemoveRequest(path_, force_);
			const unavailable = gitMutateUnavailable(rootId_);
			if (unavailable !== undefined) {
				throw unavailable;
			}
			const entry = gitWorktreeEntries.find(
				(candidate) => candidate.path === request.path,
			);
			if (entry === undefined) {
				throw gitWorktreeRemoveNotFound();
			}
			if (entry.isMain) {
				throw gitWorktreeRemoveIsMainWorktree();
			}
			if (entry.lockReason !== null) {
				throw gitWorktreeRemoveLocked();
			}
			if (!request.force && gitWorktreeDirtyPaths.has(request.path)) {
				return "needsForce";
			}
			gitWorktreeEntries = gitWorktreeEntries.filter(
				(candidate) => candidate.path !== request.path,
			);
			gitWorktreeDirtyPaths.delete(request.path);
			return "removed";
		},
		async debugAdapterConfirmationState(descriptor) {
			const request = frozenDebugAdapterConfirmationRequest(descriptor);
			return decodeDebugAdapterConfirmationState({
				confirmed:
					roots.size === 0
						? false
						: debugAdapterConfirmations.has(
								debugAdapterConfirmationKey(request),
							),
			});
		},
		async debugAdapterConfirmationGrant(descriptor) {
			if (roots.size === 0) {
				throw debugAdapterConfirmationUnavailable();
			}
			const request = frozenDebugAdapterConfirmationRequest(descriptor);
			debugAdapterConfirmations.add(debugAdapterConfirmationKey(request));
			decodeDebugAdapterConfirmationVoid(null);
		},
		async debugAdapterConfirmationRevoke(descriptor) {
			if (roots.size === 0) {
				throw debugAdapterConfirmationUnavailable();
			}
			const request = frozenDebugAdapterConfirmationRequest(descriptor);
			debugAdapterConfirmations.delete(debugAdapterConfirmationKey(request));
			decodeDebugAdapterConfirmationVoid(null);
		},
		async debugLaunch(rootId, target, adapterId, launchArguments) {
			return startMockDebugSession(rootId, target, adapterId, launchArguments);
		},
		async debugAttach(rootId, target, adapterId, launchArguments) {
			return startMockDebugSession(rootId, target, adapterId, launchArguments);
		},
		async debugDisconnect(sessionId) {
			const request = frozenDebugSessionIdRequest(sessionId);
			requireLiveMockDebugSession(request.sessionId as string);
			liveDebugSessions.delete(request.sessionId as string);
			debugSessionRoots.delete(request.sessionId as string);
		},
		async debugSetBreakpoints(sessionId, rootId, path, breakpoints) {
			const request = frozenDebugSetBreakpointsRequest(
				sessionId,
				rootId,
				path,
				breakpoints,
			);
			requireLiveMockDebugSession(
				request.sessionId as string,
				request.rootId as string,
			);
			const outcomesForPath =
				options.debugFixtureForTest?.breakpointOutcomes?.[
					request.path as string
				];
			const requested = request.breakpoints as readonly { line: number }[];
			const reported = requested.map((entry) => {
				const outcome = outcomesForPath?.[entry.line];
				if (outcome?.verified === false) {
					return Object.freeze({
						verified: false,
						line: null,
						id: null,
						message: outcome.message ?? "Breakpoint could not be set.",
					});
				}
				return Object.freeze({
					verified: true,
					line: outcome?.line ?? entry.line,
					id: null,
					message: null,
				});
			});
			return Object.freeze({ breakpoints: Object.freeze(reported) });
		},
		async debugStackTrace(sessionId, threadId, startFrame, levels) {
			const request = frozenDebugStackTraceRequest(
				sessionId,
				threadId,
				startFrame,
				levels,
			);
			requireLiveMockDebugSession(request.sessionId as string);
			const all =
				options.debugFixtureForTest?.stackFramesByThread?.[
					request.threadId as number
				] ?? [];
			const start = (request.startFrame as number | null) ?? 0;
			const levelsValue = request.levels as number | null;
			const sliced =
				levelsValue === null
					? all.slice(start)
					: all.slice(start, start + levelsValue);
			return Object.freeze({
				stackFrames: Object.freeze(sliced.map((frame) => ({ ...frame }))),
				totalFrames: all.length,
			});
		},
		async debugScopes(sessionId, frameId) {
			const request = frozenDebugScopesRequest(sessionId, frameId);
			requireLiveMockDebugSession(request.sessionId as string);
			const scopes =
				options.debugFixtureForTest?.scopesByFrame?.[
					request.frameId as number
				] ?? [];
			return Object.freeze({
				scopes: Object.freeze(scopes.map((scope) => ({ ...scope }))),
			});
		},
		async debugVariables(sessionId, variablesReference, start, count, filter) {
			const request = frozenDebugVariablesRequest(
				sessionId,
				variablesReference,
				start,
				count,
				filter,
			);
			requireLiveMockDebugSession(request.sessionId as string);
			const all =
				options.debugFixtureForTest?.variablesByReference?.[
					request.variablesReference as number
				] ?? [];
			const startIndex = (request.start as number | null) ?? 0;
			const countValue = request.count as number | null;
			const sliced =
				countValue === null
					? all.slice(startIndex)
					: all.slice(startIndex, startIndex + countValue);
			return Object.freeze({
				variables: Object.freeze(sliced.map((variable) => ({ ...variable }))),
			});
		},
		async debugEvaluate(sessionId, expression, frameId, context) {
			const request = frozenDebugEvaluateRequest(
				sessionId,
				expression,
				frameId,
				context,
			);
			requireLiveMockDebugSession(request.sessionId as string);
			const fixture =
				options.debugFixtureForTest?.evaluateByExpression?.[
					request.expression as string
				];
			if (fixture === undefined) {
				return Object.freeze({
					result: request.expression as string,
					type: null,
					variablesReference: 0,
					namedVariables: null,
					indexedVariables: null,
				});
			}
			return Object.freeze({ ...fixture });
		},
		// `F100` S4 — execution/step control. Unlike the terminal mock's fake
		// PTY, this mock does not simulate the adversarial "adapter rejects a
		// step request because the debuggee is not actually stopped" case at
		// all (that real, considered behavior is covered end to end against a
		// real spawned mock adapter in
		// `src-tauri/src/debug/service/tests.rs`'s
		// `step_control_commands_send_their_own_distinct_dap_command_and_surface_a_not_stopped_rejection`)
		// — every one of these five always succeeds for any live mock
		// session, matching this mock's own stated scope (structurally
		// correct, scriptable responses for local dev/manual exploration, not
		// a faithful re-simulation of every real adapter behavior).
		async debugContinue(sessionId, threadId) {
			const request = frozenDebugThreadRequest(sessionId, threadId);
			requireLiveMockDebugSession(request.sessionId as string);
			return Object.freeze({ allThreadsContinued: true });
		},
		async debugNext(sessionId, threadId) {
			const request = frozenDebugThreadRequest(sessionId, threadId);
			requireLiveMockDebugSession(request.sessionId as string);
		},
		async debugStepIn(sessionId, threadId, targetId) {
			const request = frozenDebugStepInRequest(sessionId, threadId, targetId);
			requireLiveMockDebugSession(request.sessionId as string);
		},
		// `F210` S4 — `debugStepInTargets`'s response is a direct fixture
		// lookup (like `debugScopes` above), not a real `stepInTargets`
		// simulation; see `stepInTargetsByFrame`'s own doc comment for why
		// this mock does not additionally reproduce the real
		// `MAX_DEBUG_STEP_IN_TARGETS` truncation boundary.
		async debugStepInTargets(sessionId, frameId) {
			const request = frozenDebugStepInTargetsRequest(sessionId, frameId);
			requireLiveMockDebugSession(request.sessionId as string);
			const targets =
				options.debugFixtureForTest?.stepInTargetsByFrame?.[
					request.frameId as number
				] ?? [];
			return Object.freeze({
				targets: Object.freeze(targets.map((target) => ({ ...target }))),
				truncated: false,
			});
		},
		async debugStepOut(sessionId, threadId) {
			const request = frozenDebugThreadRequest(sessionId, threadId);
			requireLiveMockDebugSession(request.sessionId as string);
		},
		async debugPause(sessionId, threadId) {
			const request = frozenDebugThreadRequest(sessionId, threadId);
			requireLiveMockDebugSession(request.sessionId as string);
		},
		// `F210` S5 — `debugDisassemble`'s response is a direct fixture lookup
		// (like `debugStepInTargets` above), not a real `disassemble`
		// simulation; see `disassemblyByMemoryReference`'s own doc comment for
		// why this mock does not additionally reproduce the real
		// `MAX_DEBUG_DISASSEMBLE_INSTRUCTION_COUNT`/oversized-response boundary
		// behavior.
		async debugDisassemble(
			sessionId,
			memoryReference,
			instructionOffset,
			instructionCount,
		) {
			const request = frozenDebugDisassembleRequest(
				sessionId,
				memoryReference,
				instructionOffset,
				instructionCount,
			);
			requireLiveMockDebugSession(request.sessionId as string);
			const instructions =
				options.debugFixtureForTest?.disassemblyByMemoryReference?.[
					request.memoryReference as string
				]?.[request.instructionOffset as number] ?? [];
			return Object.freeze({
				instructions: Object.freeze(
					instructions.map((instruction) => ({ ...instruction })),
				),
			});
		},
		async debugOutputAck(sessionId, sequence) {
			const request = frozenDebugOutputAckRequest(sessionId, sequence);
			const id = request.sessionId as string;
			if (!liveDebugSessions.has(id)) {
				// Mirrors the real service's own tolerant race: acking a
				// session that already ended is a harmless no-op, not an
				// error.
				return;
			}
			const gate = mockDebugOutputGate(id);
			gate.highestAcked = Math.max(
				gate.highestAcked,
				Math.min(request.sequence as number, gate.highestEmitted),
			);
			flushMockDebugOutput(id, gate);
		},
		debugWatchEvent(listener) {
			debugEventListeners.add(listener);
			return () => {
				debugEventListeners.delete(listener);
			};
		},
		async remoteSessionConnect(host, port, user) {
			const key = remoteMockTargetKey(host, port);
			const pinned = remoteKnownHosts.get(key);
			if (pinned === undefined) {
				return Object.freeze({
					status: "hostKeyPendingConfirmation",
					algorithm: "ssh-ed25519",
					sha256Fingerprint: remoteMockFingerprint(host, port, false),
					knownHostsHit: false,
				});
			}
			const changed =
				remoteFixture.changedHostKeyTargetsForTest?.includes(key) ?? false;
			const liveFingerprint = remoteMockFingerprint(host, port, changed);
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
		},
		async remoteHostKeyConfirm(host, port, user, algorithm, sha256Fingerprint) {
			const key = remoteMockTargetKey(host, port);
			// Pin exactly what the caller confirmed first (mirrors the real
			// two-phase flow: pinning happens before the post-pin
			// re-validation, so a hard failure below still leaves this pin
			// committed — see `session::RemoteSessionService::confirm_host_key`'s
			// own doc comment for why that is correct, not a bug).
			remoteKnownHosts.set(
				key,
				Object.freeze({ algorithm, sha256Fingerprint }),
			);
			const changed =
				remoteFixture.changedHostKeyTargetsForTest?.includes(key) ?? false;
			const liveFingerprint = remoteMockFingerprint(host, port, changed);
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
		},
		async remoteSessionConnectCancel() {
			// Best-effort in production; this mock never has a genuinely
			// in-flight connect to cancel (every mock call resolves
			// synchronously within one microtask), so there is nothing to do.
		},
		async remoteSessionDisconnect(sessionId) {
			const session = remoteSessions.get(sessionId);
			if (session === undefined) {
				throw remoteSessionNotFound();
			}
			remoteSessions.delete(sessionId);
			remoteEmit(
				Object.freeze({
					event: "disconnected",
					sessionId,
					host: session.host,
					port: session.port,
					user: session.user,
					reason: "userRequested",
				}),
			);
		},
		async remoteSessionState() {
			const sessions = [...remoteSessions.entries()]
				.map(([sessionId, session]) =>
					Object.freeze({
						sessionId,
						host: session.host,
						port: session.port,
						user: session.user,
					}),
				)
				.sort((left, right) =>
					left.host === right.host
						? left.port - right.port
						: left.host.localeCompare(right.host),
				);
			return Object.freeze({ sessions }) satisfies RemoteSessionStateResult;
		},
		async remoteHostKeyForget(host, port) {
			remoteKnownHosts.delete(remoteMockTargetKey(host, port));
		},
		async remoteHostKeyList() {
			const entries = [...remoteKnownHosts.entries()]
				.map(([key, entry]) => {
					const separatorIndex = key.lastIndexOf(":");
					return Object.freeze({
						host: key.slice(0, separatorIndex),
						port: Number(key.slice(separatorIndex + 1)),
						algorithm: entry.algorithm,
						sha256Fingerprint: entry.sha256Fingerprint,
					});
				})
				.sort((left, right) =>
					left.host === right.host
						? left.port - right.port
						: left.host.localeCompare(right.host),
				);
			return Object.freeze({ entries }) satisfies RemoteHostKeyListResult;
		},
		remoteSessionWatchEvent(listener) {
			remoteSessionListeners.add(listener);
			return () => {
				remoteSessionListeners.delete(listener);
			};
		},
	};
}
