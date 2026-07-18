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
const MAX_FILE_BYTES = 8 * 1_024 * 1_024;
const MOCK_MTIME = 1_700_000_000_000;
const MOCK_CTIME = 1_699_999_000_000;
const textEncoder = new TextEncoder();
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

interface MockUnsupportedNode {
	readonly kind: Exclude<WorkspaceEntryKind, "file" | "directory">;
}

type MockNode = MockFileNode | MockDirectoryNode | MockUnsupportedNode;

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

function mockUnsupportedNode(
	kind: MockUnsupportedNode["kind"],
): MockUnsupportedNode {
	return Object.freeze({ kind });
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
				"dangling-link": mockUnsupportedNode("symlink"),
				"directory-link": mockUnsupportedNode("symlinkDirectory"),
				"file-link": mockUnsupportedNode("symlinkFile"),
				other: mockUnsupportedNode("other"),
				"oversized.bin": oversizedMockFile(),
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
	return mockUnsupportedNode(node.kind);
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

export interface BrowserMockBridgeOptions {
	readonly workspacePicks?: readonly BrowserMockWorkspacePick[];
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

export function createBrowserMockBridge(
	options: BrowserMockBridgeOptions = {},
): PlainBridge {
	const listeners = new Set<(payload: RuntimeInfo) => void>();
	const scriptedPicks = [...(options.workspacePicks ?? [])];
	const roots = new Map<string, WorkspaceRoot>();
	const trees = cloneMockTrees();
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
		if (source.kind !== "file") {
			throw entryTypeMismatch();
		}
		if (source.size > MAX_FILE_BYTES) {
			throw copyFileTooLarge();
		}

		const target = resolveCreateTarget(
			request.targetRootId,
			request.targetPath,
		);
		if (target.parent.entries.has(target.name)) {
			throw entryAlreadyExists();
		}
		target.parent.entries.set(target.name, cloneMockNode(source));
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
			return frozenWorkspaceEntryStat(
				node.kind,
				node.kind === "file" ? node.size : 0,
				MOCK_MTIME,
				MOCK_CTIME,
			);
		},
		async workspaceReadDirectory(rootId, relativePath) {
			const node = resolveNode(rootId, relativePath);
			if (node.kind !== "directory") {
				throw entryTypeMismatch();
			}
			const entries = [...node.entries].map(
				([name, child]): WorkspaceDirectoryEntry => ({
					name,
					kind: child.kind,
				}),
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
