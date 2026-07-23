import type {
	BackupEntry,
	CommandError,
	PlainBridge,
	RuntimeInfo,
	WorkspaceCapabilities,
	WorkspaceCommitDeleteEntryRequest,
	WorkspaceDeleteBatchPlan,
	WorkspaceDeleteEntryKind,
	WorkspaceDeleteEntryRequest,
	WorkspaceDeleteIncompleteReason,
	WorkspaceDeleteResult,
	WorkspaceDirectoryEntry,
	WorkspaceEntryKind,
	WorkspaceMoveIncompleteReason,
	WorkspaceMoveResult,
	WorkspaceRoot,
	WorkspaceSearchFilesResult,
	WorkspaceWatchPendingRoot,
	WorkspaceWatchSyncRequest,
	WorkspaceWatchWakeEvent,
	WorkspaceWriteResult,
} from "./contracts";
import {
	backupUnavailable,
	frozenBackupDiscardRequest,
	frozenBackupWriteInputs,
} from "./backup-codec";
import {
	decodeWorkspaceSearchTextStartResult,
	frozenWorkspaceSearchFilesRequest,
	frozenWorkspaceSearchFilesResult,
	frozenWorkspaceSearchTextPollResult,
	frozenWorkspaceSearchTextStartRequest,
} from "./search-codec";
import {
	compareWorkspaceEntryNames,
	encodeWorkspaceWriteFileRequest,
	frozenWorkspaceCommitDeleteEntryRequest,
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
	frozenWorkspacePickResult,
	frozenWorkspaceReadDirectory,
	frozenWorkspaceRenameRequest,
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

function mockFile(contents: string | readonly number[]): MockFileNode {
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
	readonly key: string;
	readonly bytes: readonly number[];
}

export interface BrowserMockBridgeOptions {
	readonly workspacePicks?: readonly BrowserMockWorkspacePick[];
	/** Seeds the isolated in-memory backup store before first use. */
	readonly backupFixtureForTest?: readonly BrowserMockBackupSeedEntryForTest[];
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
	const scriptedPicks = [...(options.workspacePicks ?? [])];
	const roots = new Map<string, WorkspaceRoot>();
	const backupEntries = new Map<string, Uint8Array>();
	for (const seed of options.backupFixtureForTest ?? []) {
		const { key, content } = frozenBackupWriteInputs(
			seed.key,
			Uint8Array.from(seed.bytes),
		);
		backupEntries.set(key, content);
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
	const issuedDeleteIds = new Set<string>();
	let activeDeleteBatch: MockDeleteBatch | undefined;
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
	const expireDeleteBatch = (now: number): void => {
		if (activeDeleteBatch !== undefined && now >= activeDeleteBatch.deadline) {
			activeDeleteBatch = undefined;
		}
	};
	const invalidateDeleteBatch = (): void => {
		activeDeleteBatch = undefined;
	};

	const snapshot = () =>
		frozenWorkspaceSnapshot(MOCK_WORKSPACE_ID, revision, [...roots.values()]);
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
		if (activeDeleteBatch !== undefined) {
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
		const entries: string[] = [];
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
					entries.push(wire);
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

	const compileMockTextMatcher = (
		pattern: string,
		isRegExp: boolean,
		isCaseSensitive: boolean,
		isWordMatch: boolean,
	): RegExp => {
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
						Object.freeze({ path: wire, matches: Object.freeze(matches) }),
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

	return {
		async runtimeInfo() {
			queueMicrotask(() => {
				for (const listener of listeners) {
					listener(runtimeInfo);
				}
			});
			return runtimeInfo;
		},
		async onRuntimeReady(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
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
				return frozenWorkspacePickResult(status, snapshot());
			}

			const before = roots.size;
			for (const root of selected) {
				roots.set(root.rootId, root);
			}
			if (roots.size !== before) {
				revision += 1;
			}

			return frozenWorkspacePickResult(status, snapshot());
		},
		async workspaceRemoveRoot(rootId) {
			if (!roots.delete(rootId)) {
				throw rootNotAuthorized();
			}
			workspaceWatchStates.delete(rootId);
			invalidateDeleteBatch();
			revision += 1;
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
		async backupWrite(key, bytes) {
			if (roots.size === 0) {
				throw backupUnavailable();
			}
			const validated = frozenBackupWriteInputs(key, bytes);
			backupEntries.set(validated.key, validated.content);
		},
		async backupReadAll(): Promise<readonly BackupEntry[]> {
			if (roots.size === 0) {
				throw backupUnavailable();
			}
			const entries = [...backupEntries.entries()]
				.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
				.map(([key, bytes]): BackupEntry =>
					Object.freeze({ key, bytes: bytes.slice() }),
				);
			return Object.freeze(entries);
		},
		async backupDiscard(key) {
			if (roots.size === 0) {
				throw backupUnavailable();
			}
			const request = frozenBackupDiscardRequest(key);
			backupEntries.delete(request.key);
		},
		async backupDiscardAll() {
			if (roots.size === 0) {
				throw backupUnavailable();
			}
			backupEntries.clear();
		},
	};
}
