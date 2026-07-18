import {
	FilePermission,
	FileSystemProviderCapabilities,
	FileSystemProviderErrorCode,
	FileType,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { describe, expect, it, vi } from "vitest";

import {
	createPlainWorkspaceFileSystemProvider,
	PlainWorkspaceFileSystemProvider,
	PLAIN_WORKSPACE_SCHEME,
} from "../../app/features/workspace/file-system-provider";
import { createBrowserMockBridge } from "../../app/platform/tauri/browser-mock";
import type {
	PlainBridge,
	RuntimeInfo,
	WorkspaceEntryKind,
} from "../../app/platform/tauri/contracts";
import { frozenWorkspaceFileData } from "../../app/platform/tauri/workspace-codec";

const rootId = "00000000-0000-4000-8000-000000000101";
const rootUri = `${PLAIN_WORKSPACE_SCHEME}://${rootId}/`;
const runtimeInfo: RuntimeInfo = Object.freeze({
	application: "Plain",
	ipcVersion: 1,
	runtime: "browser-mock",
});

function workspaceUri(relativePath = ""): URI {
	return URI.parse(`${rootUri}${relativePath}`);
}

function commandError(
	code: string,
	secret = "/Users/private/workspace",
): object {
	return { code, message: `Native failure at ${secret}`, details: { secret } };
}

function testBridge(overrides: Partial<PlainBridge> = {}): PlainBridge {
	return {
		async runtimeInfo() {
			return runtimeInfo;
		},
		async onRuntimeReady() {
			return () => {};
		},
		async workspaceSnapshot() {
			throw new Error("unused");
		},
		async workspacePickRoots() {
			throw new Error("unused");
		},
		async workspaceRemoveRoot() {
			throw new Error("unused");
		},
		async workspaceCreateFile() {
			throw new Error("unused");
		},
		async workspaceCreateDirectory() {
			throw new Error("unused");
		},
		async workspaceRename() {
			throw new Error("unused");
		},
		async workspaceStat() {
			return { kind: "file", size: 3, mtime: 20, ctime: 10 };
		},
		async workspaceReadDirectory() {
			return { entries: [] };
		},
		async workspaceReadFile() {
			return frozenWorkspaceFileData([1, 2, 3]);
		},
		...overrides,
	};
}

async function rejected(error: Promise<unknown>): Promise<{
	readonly code: string;
	readonly message: string;
}> {
	try {
		await error;
		expect.fail("operation must reject");
	} catch (candidate) {
		return candidate as { readonly code: string; readonly message: string };
	}
}

describe("Plain workspace file system provider", () => {
	it("declares only read/write transport plus readonly semantics", () => {
		const provider = createPlainWorkspaceFileSystemProvider(testBridge());

		expect(provider).toBeInstanceOf(PlainWorkspaceFileSystemProvider);
		expect(provider.capabilities).toBe(
			FileSystemProviderCapabilities.FileReadWrite |
				FileSystemProviderCapabilities.Readonly,
		);
		expect(
			provider.capabilities & FileSystemProviderCapabilities.PathCaseSensitive,
		).toBe(0);
	});

	it("maps every Rust entry kind and explicit readonly stat metadata", async () => {
		const kinds: WorkspaceEntryKind[] = [
			"file",
			"directory",
			"symlink",
			"symlinkFile",
			"symlinkDirectory",
			"other",
		];
		const expectedTypes = [
			FileType.File,
			FileType.Directory,
			FileType.SymbolicLink,
			FileType.SymbolicLink | FileType.File,
			FileType.SymbolicLink | FileType.Directory,
			FileType.Unknown,
		];
		const stat = vi.fn(async (_rootId: string, relativePath: string) => ({
			kind: kinds[Number(relativePath)]!,
			size: 42,
			mtime: 1_700_000_000_000,
			ctime: 1_699_000_000_000,
		}));
		const provider = createPlainWorkspaceFileSystemProvider(
			testBridge({ workspaceStat: stat }),
		);

		for (let index = 0; index < kinds.length; index += 1) {
			const result = await provider.stat(workspaceUri(String(index)));
			expect(result).toEqual({
				type: expectedTypes[index],
				size: 42,
				mtime: 1_700_000_000_000,
				ctime: 1_699_000_000_000,
				permissions: FilePermission.Readonly,
			});
			expect(Object.isFrozen(result)).toBe(true);
		}
		expect(stat).toHaveBeenCalledWith(rootId, "0");
	});

	it("maps directory entries and returns an owned file byte copy", async () => {
		const bytes = Uint8Array.from([0, 255, 128, 42]);
		const readDirectory = vi.fn(async () => ({
			entries: [
				{ name: "file", kind: "file" as const },
				{ name: "folder", kind: "directory" as const },
				{ name: "link", kind: "symlink" as const },
				{ name: "link-file", kind: "symlinkFile" as const },
				{ name: "link-folder", kind: "symlinkDirectory" as const },
				{ name: "socket", kind: "other" as const },
			],
		}));
		const readFile = vi.fn(async () => frozenWorkspaceFileData(bytes));
		const provider = createPlainWorkspaceFileSystemProvider(
			testBridge({
				workspaceReadDirectory: readDirectory,
				workspaceReadFile: readFile,
			}),
		);

		expect(await provider.readdir(workspaceUri("src"))).toEqual([
			["file", FileType.File],
			["folder", FileType.Directory],
			["link", FileType.SymbolicLink],
			["link-file", FileType.SymbolicLink | FileType.File],
			["link-folder", FileType.SymbolicLink | FileType.Directory],
			["socket", FileType.Unknown],
		]);
		const first = await provider.readFile(workspaceUri("binary.bin"));
		first[0] = 99;
		expect([...bytes]).toEqual([0, 255, 128, 42]);
		expect([...(await provider.readFile(workspaceUri("binary.bin")))]).toEqual([
			0, 255, 128, 42,
		]);
		expect(readDirectory).toHaveBeenCalledWith(rootId, "src");
		expect(readFile).toHaveBeenCalledWith(rootId, "binary.bin");
	});

	it("accepts only canonical Plain URIs and forwards literal percent names once", async () => {
		const stat = vi.fn(async () => ({
			kind: "file" as const,
			size: 0,
			mtime: 0,
			ctime: 0,
		}));
		const provider = createPlainWorkspaceFileSystemProvider(
			testBridge({ workspaceStat: stat }),
		);

		await provider.stat(workspaceUri());
		await provider.stat(URI.parse(`${rootUri}%252e%252e/%252F`));
		expect(stat).toHaveBeenNthCalledWith(1, rootId, "");
		expect(stat).toHaveBeenNthCalledWith(2, rootId, "%2e%2e/%2F");

		const invalid = [
			URI.parse(`file://${rootId}/src`),
			URI.parse(`PLAIN-WORKSPACE://${rootId}/src`),
			URI.parse(`${rootUri}src?query=private`),
			URI.parse(`${rootUri}src#private`),
			URI.parse(
				`${PLAIN_WORKSPACE_SCHEME}://00000000-0000-4000-8000-000000000ABC/src`,
			),
			URI.parse(
				`${PLAIN_WORKSPACE_SCHEME}://00000000-0000-3000-8000-000000000101/src`,
			),
			URI.from({ scheme: PLAIN_WORKSPACE_SCHEME, authority: rootId, path: "" }),
			URI.from({
				scheme: PLAIN_WORKSPACE_SCHEME,
				authority: rootId,
				path: "/../private",
			}),
			URI.parse(`${rootUri}%2e%2e/private`),
			URI.parse(`${rootUri}%2Fprivate`),
			URI.from({
				scheme: PLAIN_WORKSPACE_SCHEME,
				authority: rootId,
				path: "/src//main.ts",
			}),
			URI.from({
				scheme: PLAIN_WORKSPACE_SCHEME,
				authority: rootId,
				path: "/src\\main.ts",
			}),
			URI.from({
				scheme: PLAIN_WORKSPACE_SCHEME,
				authority: rootId,
				path: "/stream:name",
			}),
			URI.from({
				scheme: PLAIN_WORKSPACE_SCHEME,
				authority: rootId,
				path: "/src/",
			}),
		];
		for (const resource of invalid) {
			const error = await rejected(provider.stat(resource));
			expect(error.code).toBe(FileSystemProviderErrorCode.NoPermissions);
			expect(error.message).not.toContain("private");
		}
		expect(stat).toHaveBeenCalledTimes(2);
	});

	it("delegates syntactically valid root authorization solely to the bridge", async () => {
		const unknownRoot = "00000000-0000-4000-8000-000000000999";
		const stat = vi.fn(async () => {
			throw commandError("ROOT_NOT_AUTHORIZED");
		});
		const provider = createPlainWorkspaceFileSystemProvider(
			testBridge({ workspaceStat: stat }),
		);

		const error = await rejected(
			provider.stat(
				URI.parse(`${PLAIN_WORKSPACE_SCHEME}://${unknownRoot}/README.md`),
			),
		);
		expect(stat).toHaveBeenCalledWith(unknownRoot, "README.md");
		expect(error.code).toBe(FileSystemProviderErrorCode.NoPermissions);
		expect(error.message).toBe("The workspace entry cannot be accessed.");
	});

	it("maps the closed Rust error set without exposing native messages", async () => {
		const mappings = [
			["ENTRY_NOT_FOUND", FileSystemProviderErrorCode.FileNotFound],
			["ENTRY_TYPE_MISMATCH", FileSystemProviderErrorCode.FileNotADirectory],
			["ROOT_NOT_AUTHORIZED", FileSystemProviderErrorCode.NoPermissions],
			["INVALID_RELATIVE_PATH", FileSystemProviderErrorCode.NoPermissions],
			["PATH_OUTSIDE_ROOT", FileSystemProviderErrorCode.NoPermissions],
			["PERMISSION_DENIED", FileSystemProviderErrorCode.NoPermissions],
			["ROOT_UNAVAILABLE", FileSystemProviderErrorCode.Unavailable],
			["PATH_ENCODING_UNSUPPORTED", FileSystemProviderErrorCode.Unavailable],
			["DIRECTORY_TOO_LARGE", FileSystemProviderErrorCode.Unavailable],
			["FILE_TOO_LARGE", FileSystemProviderErrorCode.Unavailable],
			["IO_FAILED", FileSystemProviderErrorCode.Unavailable],
			["UNRECOGNIZED", FileSystemProviderErrorCode.Unavailable],
		] as const;

		for (const [nativeCode, providerCode] of mappings) {
			const provider = createPlainWorkspaceFileSystemProvider(
				testBridge({
					async workspaceStat() {
						throw commandError(nativeCode);
					},
				}),
			);
			const error = await rejected(provider.stat(workspaceUri("private")));
			expect(error.code).toBe(providerCode);
			expect(error.message).not.toContain("/Users/private");
			expect(error.message).not.toContain(nativeCode);
		}

		const provider = createPlainWorkspaceFileSystemProvider(
			testBridge({
				async workspaceStat() {
					throw new Error("secret /Users/private/workspace");
				},
			}),
		);
		const unknown = await rejected(provider.stat(workspaceUri("private")));
		expect(unknown.code).toBe(FileSystemProviderErrorCode.Unavailable);
		expect(unknown.message).toBe("The workspace is unavailable.");
	});

	it("uses the same type mismatch mapping for stat, directory and file reads", async () => {
		const mismatch = async () => {
			throw commandError("ENTRY_TYPE_MISMATCH");
		};
		const provider = createPlainWorkspaceFileSystemProvider(
			testBridge({
				workspaceStat: mismatch,
				workspaceReadDirectory: mismatch,
				workspaceReadFile: mismatch,
			}),
		);

		for (const operation of [
			provider.stat(workspaceUri("entry")),
			provider.readdir(workspaceUri("entry")),
			provider.readFile(workspaceUri("entry")),
		]) {
			expect((await rejected(operation)).code).toBe(
				FileSystemProviderErrorCode.FileNotADirectory,
			);
		}
	});

	it("rejects every write operation with a stable NoPermissions error", async () => {
		const provider = createPlainWorkspaceFileSystemProvider(testBridge());
		const from = workspaceUri("from");
		const to = workspaceUri("to");

		for (const operation of [
			provider.writeFile(from, new Uint8Array([1]), {
				create: true,
				overwrite: false,
				unlock: false,
				atomic: false,
			}),
			provider.mkdir(from),
			provider.delete(from, {
				recursive: false,
				useTrash: false,
				atomic: false,
			}),
			provider.rename(from, to, { overwrite: false }),
		]) {
			const error = await rejected(operation);
			expect(error.code).toBe(FileSystemProviderErrorCode.NoPermissions);
			expect(error.message).toBe("The workspace entry cannot be accessed.");
		}
	});

	it("provides a strict no-op watcher without broadening URI access", () => {
		const provider = createPlainWorkspaceFileSystemProvider(testBridge());
		const disposable = provider.watch(workspaceUri("src"), {
			recursive: true,
			excludes: [],
		});
		expect(() => disposable.dispose()).not.toThrow();
		expect(() =>
			provider.watch(URI.parse(`file://${rootId}/src`), {
				recursive: true,
				excludes: [],
			}),
		).toThrowError(
			expect.objectContaining({
				code: FileSystemProviderErrorCode.NoPermissions,
			}),
		);
	});

	it("observes native revocation immediately because it never caches roots", async () => {
		const bridge = createBrowserMockBridge();
		const picked = await bridge.workspacePickRoots("replace");
		const root = picked.snapshot.roots[0]!;
		const provider = createPlainWorkspaceFileSystemProvider(bridge);
		const readme = URI.parse(`${root.uri}README.md`);

		expect((await provider.stat(readme)).type).toBe(FileType.File);
		await bridge.workspaceRemoveRoot(root.rootId);
		const revoked = await rejected(provider.readFile(readme));
		expect(revoked.code).toBe(FileSystemProviderErrorCode.NoPermissions);
		expect(revoked.message).toBe("The workspace entry cannot be accessed.");
	});
});
