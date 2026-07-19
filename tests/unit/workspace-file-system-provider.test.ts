import {
	FileChangeType,
	FileOperationResult,
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
import { frozenWorkspaceReadFile } from "../../app/platform/tauri/workspace-codec";

const rootId = "00000000-0000-4000-8000-000000000101";
const rootUri = `${PLAIN_WORKSPACE_SCHEME}://${rootId}/`;
const versionA = `wv1:${"a".repeat(64)}`;
const versionB = `wv1:${"b".repeat(64)}`;
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
		async workspaceCopy() {
			throw new Error("unused");
		},
		async workspaceMove() {
			throw new Error("unused");
		},
		async workspacePrepareDelete() {
			throw new Error("unused");
		},
		async workspaceCancelDelete() {
			throw new Error("unused");
		},
		async workspaceBeginDelete() {
			throw new Error("unused");
		},
		async workspaceCommitDeleteEntry() {
			throw new Error("unused");
		},
		async workspaceStat() {
			return {
				kind: "file",
				size: 3,
				mtime: 20,
				ctime: 10,
				version: versionA,
			};
		},
		async workspaceReadDirectory() {
			return { entries: [] };
		},
		async workspaceReadFile() {
			return frozenWorkspaceReadFile(
				{
					kind: "file",
					size: 3,
					mtime: 20,
					ctime: 10,
					version: versionA,
				},
				Uint8Array.from([1, 2, 3]),
			);
		},
		async workspaceWriteFile() {
			throw new Error("unused");
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

	it("maps every Rust entry kind with an own opaque version field", async () => {
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
		const versions = [versionA, null, null, null, null, null] as const;
		const stat = vi.fn(async (_rootId: string, relativePath: string) => ({
			kind: kinds[Number(relativePath)]!,
			size: 42,
			mtime: 1_700_000_000_000,
			ctime: 1_699_000_000_000,
			version: versions[Number(relativePath)]!,
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
				...(kinds[index] === "symlinkFile"
					? { permissions: FilePermission.Readonly }
					: {}),
				plainVersion: versions[index],
			});
			expect(Object.isFrozen(result)).toBe(true);
			expect(
				Object.getOwnPropertyDescriptor(result, "plainVersion"),
			).toMatchObject({ value: versions[index] });
		}
		expect(stat).toHaveBeenCalledWith(rootId, "0");
	});

	it("marks tokenless regular files readonly without marking directories", async () => {
		const provider = createPlainWorkspaceFileSystemProvider(
			testBridge({
				async workspaceStat(_rootId, relativePath) {
					return {
						kind: relativePath === "file" ? "file" : "directory",
						size: 0,
						mtime: 0,
						ctime: 0,
						version: null,
					};
				},
				async workspaceReadFile() {
					return frozenWorkspaceReadFile(
						{
							kind: "file",
							size: 0,
							mtime: 0,
							ctime: 0,
							version: null,
						},
						new Uint8Array(),
					);
				},
			}),
		);

		expect(await provider.stat(workspaceUri("file"))).toMatchObject({
			permissions: FilePermission.Readonly,
			plainVersion: null,
		});
		const directory = await provider.stat(workspaceUri("directory"));
		expect(directory.plainVersion).toBeNull();
		expect(directory.permissions).toBeUndefined();
		expect(
			(await provider.plainReadFile(workspaceUri("file"))).stat,
		).toMatchObject({
			plainVersion: null,
			permissions: FilePermission.Readonly,
		});
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
		const readFile = vi.fn(async () =>
			frozenWorkspaceReadFile(
				{
					kind: "file",
					size: bytes.byteLength,
					mtime: 20,
					ctime: 10,
					version: versionA,
				},
				bytes,
			),
		);
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
		const receipt = await provider.plainReadFile(workspaceUri("binary.bin"));
		expect(receipt.stat).toEqual({
			type: FileType.File,
			size: 4,
			mtime: 20,
			ctime: 10,
			plainVersion: versionA,
		});
		expect(Object.isFrozen(receipt)).toBe(true);
		expect(Object.isFrozen(receipt.stat)).toBe(true);
		const first = receipt.value;
		first[0] = 99;
		expect([...bytes]).toEqual([0, 255, 128, 42]);
		expect([...(await provider.readFile(workspaceUri("binary.bin")))]).toEqual([
			0, 255, 128, 42,
		]);
		expect(readDirectory).toHaveBeenCalledWith(rootId, "src");
		expect(readFile).toHaveBeenCalledWith(rootId, "binary.bin");
	});

	it("keeps content and version in one bridge receipt without a stat race", async () => {
		const stat = vi.fn(async () => ({
			kind: "file" as const,
			size: 4,
			mtime: 200,
			ctime: 100,
			version: versionB,
		}));
		const readFile = vi.fn(async () =>
			frozenWorkspaceReadFile(
				{
					kind: "file",
					size: 4,
					mtime: 20,
					ctime: 10,
					version: versionA,
				},
				Uint8Array.from([1, 2, 3, 4]),
			),
		);
		const provider = createPlainWorkspaceFileSystemProvider(
			testBridge({ workspaceStat: stat, workspaceReadFile: readFile }),
		);

		const receipt = await provider.plainReadFile(workspaceUri("racing.bin"));
		expect([...receipt.value]).toEqual([1, 2, 3, 4]);
		expect(receipt.stat.plainVersion).toBe(versionA);
		expect(receipt.stat.mtime).toBe(20);
		expect(stat).not.toHaveBeenCalled();
		expect(readFile).toHaveBeenCalledTimes(1);
	});

	it("accepts only canonical Plain URIs and forwards literal percent names once", async () => {
		const stat = vi.fn(async () => ({
			kind: "file" as const,
			size: 0,
			mtime: 0,
			ctime: 0,
			version: null,
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
			["WORKSPACE_FILE_CHANGED", FileSystemProviderErrorCode.Unavailable],
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

	it("exposes one private versioned-write receipt while the public provider stays readonly", async () => {
		const write = vi.fn(async () =>
			Object.freeze({
				status: "written" as const,
				stat: Object.freeze({
					kind: "file" as const,
					size: 3,
					mtime: 30,
					ctime: 20,
					version: versionB,
				}),
			}),
		);
		const provider = createPlainWorkspaceFileSystemProvider(
			testBridge({ workspaceWriteFile: write }),
		);
		const content = Uint8Array.from([4, 5, 6]);

		const result = await provider.plainWriteFile(
			workspaceUri("src/main.ts"),
			content,
			versionA,
		);
		expect(result).toEqual({
			status: "written",
			stat: {
				type: FileType.File,
				size: 3,
				mtime: 30,
				ctime: 20,
				plainVersion: versionB,
			},
		});
		expect(Object.isFrozen(result)).toBe(true);
		if (result.status === "written") {
			expect(Object.isFrozen(result.stat)).toBe(true);
		}
		expect(write).toHaveBeenCalledWith(
			rootId,
			"src/main.ts",
			versionA,
			content,
		);
	});

	it("publishes one root rescan before returning every incomplete or unknown outcome", async () => {
		const outcomes = [
			Object.freeze({
				status: "targetPublished" as const,
				publicationEvidence: "targetObservedWritten" as const,
				rename: "reportedFailure" as const,
				directorySync: "failed" as const,
				target: "changed" as const,
			}),
			Object.freeze({
				status: "outcomeUnknown" as const,
				observation: "responseUnavailable" as const,
				rename: "unobserved" as const,
				directorySync: "unobserved" as const,
				target: "ambiguous" as const,
			}),
		];
		let outcomeIndex = 0;
		const provider = createPlainWorkspaceFileSystemProvider(
			testBridge({
				async workspaceWriteFile() {
					return outcomes[outcomeIndex++ % outcomes.length]!;
				},
			}),
		);
		const order: string[] = [];
		const events: (readonly {
			readonly type: FileChangeType;
			readonly resource: URI;
		}[])[] = [];
		const listener = provider.onDidChangeFile(
			(
				event: readonly {
					readonly type: FileChangeType;
					readonly resource: URI;
				}[],
			) => {
				order.push("event");
				events.push(event);
			},
		);

		for (const expected of outcomes) {
			const result = await provider.plainWriteFile(
				workspaceUri("src/main.ts"),
				new Uint8Array([1]),
				versionA,
			);
			order.push("result");
			expect(result).toBe(expected);
		}
		listener.dispose();
		const resultAfterDispose = await provider.plainWriteFile(
			workspaceUri("src/main.ts"),
			new Uint8Array([1]),
			versionA,
		);

		expect(order).toEqual(["event", "result", "event", "result"]);
		expect(resultAfterDispose).toBe(outcomes[0]);
		expect(events).toHaveLength(2);
		for (const event of events) {
			expect(Object.isFrozen(event)).toBe(true);
			expect(event).toHaveLength(1);
			expect(Object.isFrozen(event[0])).toBe(true);
			expect(event[0]!.type).toBe(FileChangeType.UPDATED);
			expect(event[0]!.resource.toString()).toBe(rootUri);
			expect(event[0]!.resource.path).toBe("/");
			expect(event[0]!.resource.query).toBe("");
			expect(event[0]!.resource.fragment).toBe("");
		}
	});

	it("maps pre-publication write errors without leaking native details", async () => {
		for (const [nativeCode, expected] of [
			["WORKSPACE_FILE_MODIFIED", FileOperationResult.FILE_MODIFIED_SINCE],
			["FILE_TOO_LARGE", FileSystemProviderErrorCode.FileTooLarge],
			["PERMISSION_DENIED", FileSystemProviderErrorCode.NoPermissions],
			["IO_FAILED", FileSystemProviderErrorCode.Unavailable],
		] as const) {
			const provider = createPlainWorkspaceFileSystemProvider(
				testBridge({
					async workspaceWriteFile() {
						throw commandError(nativeCode);
					},
				}),
			);
			const changeListener = vi.fn();
			const changeSubscription = provider.onDidChangeFile(changeListener);
			const error = await rejected(
				provider.plainWriteFile(
					workspaceUri("private"),
					new Uint8Array(),
					versionA,
				),
			);
			changeSubscription.dispose();
			if (typeof expected === "number") {
				expect(error).toMatchObject({ fileOperationResult: expected });
			} else {
				expect(error.code).toBe(expected);
			}
			expect(error.message).not.toContain("/Users/private");
			expect(error.message).not.toContain(nativeCode);
			expect(changeListener).not.toHaveBeenCalled();
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
