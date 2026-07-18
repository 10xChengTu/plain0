import type {
	CommandError,
	PlainBridge,
	RuntimeInfo,
	WorkspaceDirectoryEntry,
	WorkspaceEntryKind,
	WorkspaceRoot,
} from "./contracts";
import {
	compareWorkspaceEntryNames,
	frozenWorkspaceCopyRequest,
	frozenWorkspaceEntryStat,
	frozenWorkspaceCreateEntryRequest,
	frozenWorkspaceEntryRequest,
	frozenWorkspaceFileData,
	frozenWorkspacePickResult,
	frozenWorkspaceReadDirectory,
	frozenWorkspaceRenameRequest,
	frozenWorkspaceSnapshot,
	isPortableWorkspaceEntryName,
	workspaceRelativePathSegments,
} from "./workspace-codec";

const runtimeInfo: RuntimeInfo = Object.freeze({
	application: "Plain",
	ipcVersion: 1,
	runtime: "browser-mock",
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
			return resolveMockNodeFollowingSymlinks(
				root,
				[...targetSegments, ...segments.slice(index + 1)],
				nextSeen,
				depth + 1,
			);
		}
		node = child;
		traversed.push(segment);
	}
	return node;
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

export interface BrowserMockBridgeOptions {
	readonly workspacePicks?: readonly BrowserMockWorkspacePick[];
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

export function createBrowserMockBridge(
	options: BrowserMockBridgeOptions = {},
): PlainBridge {
	const listeners = new Set<(payload: RuntimeInfo) => void>();
	const scriptedPicks = [...(options.workspacePicks ?? [])];
	const roots = new Map<string, WorkspaceRoot>();
	const trees = cloneMockTrees();
	const directoryCopyLimits = resolveDirectoryCopyLimits(
		options.directoryCopyLimitsForTest,
	);
	installDirectoryCopyFixtureForTest(
		trees,
		options.directoryCopyFixtureForTest,
	);
	let revision = 0;

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
	const createEntry = (
		rootId: string,
		relativePath: string,
		entry: MockNode,
	): void => {
		const { parent, name } = resolveCreateTarget(rootId, relativePath);
		if (parent.entries.has(name)) {
			throw entryAlreadyExists();
		}
		parent.entries.set(name, entry);
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
	};
	const copyEntry = (
		sourceRootId: string,
		sourcePath: string,
		targetRootId: string,
		targetPath: string,
	): void => {
		const request = frozenWorkspaceCopyRequest(
			sourceRootId,
			sourcePath,
			targetRootId,
			targetPath,
		);
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

		const source = resolveNode(request.sourceRootId, request.sourcePath);
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
		if (target.parent.entries.has(target.name)) {
			throw entryAlreadyExists();
		}
		target.parent.entries.set(target.name, copied);
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
		async workspaceSnapshot() {
			return snapshot();
		},
		async workspacePickRoots(mode) {
			const status = scriptedPicks.shift() ?? "selected";
			if (status === "cancelled") {
				return frozenWorkspacePickResult(status, snapshot());
			}

			const selected = mode === "add" ? mockRoots : mockRoots.slice(0, 1);
			if (mode === "replace") {
				const replacement = selected[0]!;
				if (roots.size !== 1 || !roots.has(replacement.rootId)) {
					roots.clear();
					roots.set(replacement.rootId, replacement);
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
			revision += 1;
			return snapshot();
		},
		async workspaceCreateFile(rootId, relativePath) {
			createEntry(rootId, relativePath, mockFile([]));
		},
		async workspaceCreateDirectory(rootId, relativePath) {
			createEntry(rootId, relativePath, mockDirectory({}));
		},
		async workspaceRename(rootId, sourcePath, targetPath) {
			renameEntry(rootId, sourcePath, targetPath);
		},
		async workspaceCopy(sourceRootId, sourcePath, targetRootId, targetPath) {
			copyEntry(sourceRootId, sourcePath, targetRootId, targetPath);
		},
		async workspaceStat(rootId, relativePath) {
			const node = resolveNode(rootId, relativePath);
			const root = trees.get(rootId);
			if (root === undefined) {
				throw rootNotAuthorized();
			}
			const classified = classifyMockNode(root, relativePath, node);
			return frozenWorkspaceEntryStat(
				classified.kind,
				classified.size,
				MOCK_MTIME,
				MOCK_CTIME,
			);
		},
		async workspaceReadDirectory(rootId, relativePath) {
			const node = resolveNode(rootId, relativePath);
			if (node.kind !== "directory") {
				throw entryTypeMismatch();
			}
			const root = trees.get(rootId);
			if (root === undefined) {
				throw rootNotAuthorized();
			}
			const entries = [...node.entries].map(
				([name, child]): WorkspaceDirectoryEntry => {
					const childPath =
						relativePath.length === 0 ? name : `${relativePath}/${name}`;
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
			const node = resolveNode(rootId, relativePath);
			if (node.kind !== "file") {
				throw entryTypeMismatch();
			}
			if (node.size > MAX_FILE_BYTES) {
				throw fileTooLarge();
			}
			return frozenWorkspaceFileData(node.bytes);
		},
	};
}
