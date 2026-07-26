import {
	FileChangeType,
	FileOperationResult,
	FilePermission,
	FileSystemProviderCapabilities,
	FileSystemProviderErrorCode,
	FileType,
	type IFileOverwriteOptions,
	type IFileDeleteOptions,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { Event } from "@codingame/monaco-vscode-api/vscode/vs/base/common/event";
import {
	authorizePlainWorkspaceDeleteResourceEdit,
	getPlainWorkspaceDeleteState,
	movePlainWorkspaceDeleteFileServiceAuthorization,
	movePlainWorkspaceDeleteResourceEditAuthorization,
	movePlainWorkspaceDeleteWorkingCopyAuthorization,
	type PlainWorkspaceDeleteAuthorization,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/plainWorkspaceDelete";
import { describe, expect, it, vi } from "vitest";

import {
	createPlainWorkspaceFileSystemProvider as createProviderWithCapabilities,
	PLAIN_WORKSPACE_SCHEME,
} from "../../app/features/workspace/file-system-provider";
import { createBrowserMockBridge } from "../../app/platform/tauri/browser-mock";
import type {
	PlainBridge,
	RuntimeInfo,
	WorkspaceCapabilities,
	WorkspaceEntryKind,
	WorkspaceMoveResult,
} from "../../app/platform/tauri/contracts";
import { frozenWorkspaceReadFile } from "../../app/platform/tauri/workspace-codec";

const rootId = "00000000-0000-4000-8000-000000000101";
const targetRootId = "00000000-0000-4000-8000-000000000202";
const rootUri = `${PLAIN_WORKSPACE_SCHEME}://${rootId}/`;
const versionA = `wv1:${"a".repeat(64)}`;
const versionB = `wv1:${"b".repeat(64)}`;
const runtimeInfo: RuntimeInfo = Object.freeze({
	application: "Plain",
	ipcVersion: 1,
	runtime: "browser-mock",
});
const supportedCapabilities: WorkspaceCapabilities = Object.freeze({
	create: true,
	renameNoReplace: true,
	copyMove: true,
	delete: true,
	versionedWrite: true,
});

type ProviderChanges = readonly Readonly<{
	type: FileChangeType;
	resource: URI;
}>[];

function workspaceUri(relativePath = ""): URI {
	return URI.parse(`${rootUri}${relativePath}`);
}

function rootedWorkspaceUri(workspaceRootId: string, relativePath = ""): URI {
	return URI.parse(
		`${PLAIN_WORKSPACE_SCHEME}://${workspaceRootId}/${relativePath}`,
	);
}

function authorizedProviderDelete(
	resource: URI,
	kind: "file" | "directory" | "symlink" = "file",
): Readonly<{
	options: IFileDeleteOptions;
	authorization: PlainWorkspaceDeleteAuthorization;
}> {
	const resourceEditOptions = {
		recursive: true,
		folder: kind === "directory",
		ignoreIfNotExists: false,
		skipTrashBin: true,
	};
	const authorization = authorizePlainWorkspaceDeleteResourceEdit(
		resourceEditOptions,
		resource,
		{
			confirmationId: "00000000-0000-4000-8000-000000000303",
			entryId: "00000000-0000-4000-8000-000000000404",
			rootId: resource.authority,
			relativePath: resource.path.slice(1),
			recursive: true,
			kind,
			permanent: true,
		},
	);
	const operation = { resource, recursive: true, useTrash: false };
	expect(
		movePlainWorkspaceDeleteResourceEditAuthorization(
			resourceEditOptions,
			resource,
			operation,
		),
	).toBe(true);
	const fileOptions = { recursive: true, useTrash: false, atomic: false };
	expect(
		movePlainWorkspaceDeleteWorkingCopyAuthorization(
			operation,
			resource,
			fileOptions,
		),
	).toBe(true);
	const providerOptions = {
		recursive: true,
		useTrash: false,
		atomic: false,
	} as const;
	expect(
		movePlainWorkspaceDeleteFileServiceAuthorization(
			fileOptions,
			resource,
			providerOptions,
		),
	).toBe(true);
	return Object.freeze({
		options: providerOptions,
		authorization,
	});
}

function exactCommandError(code: string): object {
	return Object.freeze({
		code,
		message: "The native workspace mutation failed.",
	});
}

function hostileNonPrimitivePathUri(): {
	readonly resource: URI;
	readonly methodReads: () => number;
} {
	let reads = 0;
	const resource = Object.assign(Object.create(null), {
		scheme: PLAIN_WORKSPACE_SCHEME,
		authority: rootId,
		path: {
			get length() {
				reads += 1;
				return 12;
			},
			startsWith() {
				reads += 1;
				return true;
			},
			slice() {
				reads += 1;
				return "safe";
			},
			toString() {
				reads += 1;
				return "/private";
			},
		},
		query: "",
		fragment: "",
	}) as unknown as URI;
	return { resource, methodReads: () => reads };
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
		async workspaceCapabilities() {
			return {
				create: true,
				renameNoReplace: true,
				copyMove: true,
				delete: true,
				versionedWrite: true,
			};
		},
		async workspaceSnapshot() {
			throw new Error("unused");
		},
		workspaceReconcileWatchRoots() {},
		workspaceWatch() {
			return () => {};
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
		async workspaceSearchFiles() {
			throw new Error("unused");
		},
		async workspaceSearchTextStart() {
			throw new Error("unused");
		},
		async workspaceSearchTextPoll() {
			throw new Error("unused");
		},
		async workspaceSearchTextCancel() {
			throw new Error("unused");
		},
		workspaceSearchTextWatch() {
			return () => {};
		},
		async backupWrite() {
			throw new Error("unused");
		},
		async backupReadAll() {
			throw new Error("unused");
		},
		async backupDiscard() {
			throw new Error("unused");
		},
		async backupDiscardAll() {
			throw new Error("unused");
		},
		async themeImportVsix() {
			throw new Error("unused");
		},
		async themeImportDirectory() {
			throw new Error("unused");
		},
		async themeList() {
			throw new Error("unused");
		},
		async themeReadResource() {
			throw new Error("unused");
		},
		async themeRemove() {
			throw new Error("unused");
		},
		async themeGetSelection() {
			throw new Error("unused");
		},
		async themeSetSelection() {
			throw new Error("unused");
		},
		async themeSetFileIconThemeSelection() {
			throw new Error("unused");
		},
		async themeSetProductIconThemeSelection() {
			throw new Error("unused");
		},
		async terminalStart() {
			throw new Error("unused");
		},
		async terminalInputText() {
			throw new Error("unused");
		},
		async terminalInputKey() {
			throw new Error("unused");
		},
		async terminalFocus() {
			throw new Error("unused");
		},
		async terminalResize() {
			throw new Error("unused");
		},
		async terminalAck() {
			throw new Error("unused");
		},
		async terminalScrollback() {
			throw new Error("unused");
		},
		async terminalKill() {
			throw new Error("unused");
		},
		terminalWatchData() {
			throw new Error("unused");
		},
		terminalWatchExit() {
			throw new Error("unused");
		},
		async workspaceTrustState() {
			throw new Error("unused");
		},
		async workspaceTrustGrant() {
			throw new Error("unused");
		},
		async workspaceTrustRevoke() {
			throw new Error("unused");
		},
		async gitStatus() {
			throw new Error("unused");
		},
		async gitDiffFiles() {
			throw new Error("unused");
		},
		async gitShowBlob() {
			throw new Error("unused");
		},
		async gitStagePaths() {
			throw new Error("unused");
		},
		async gitUnstagePaths() {
			throw new Error("unused");
		},
		async gitStageBlob() {
			throw new Error("unused");
		},
		async gitCommit() {
			throw new Error("unused");
		},
		async gitDiscardPaths() {
			throw new Error("unused");
		},
		async gitNetworkPreview() {
			throw new Error("unused");
		},
		async gitFetch() {
			throw new Error("unused");
		},
		async gitPull() {
			throw new Error("unused");
		},
		async gitPush() {
			throw new Error("unused");
		},
		async gitNetworkCancel() {
			throw new Error("unused");
		},
		async gitBlameFile() {
			throw new Error("unused");
		},
		async gitBlameCommitMessages() {
			throw new Error("unused");
		},
		...overrides,
	};
}

function createPlainWorkspaceFileSystemProvider(
	bridge: PlainBridge,
	platformCapabilities: WorkspaceCapabilities = supportedCapabilities,
) {
	return createProviderWithCapabilities(bridge, platformCapabilities);
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
	it("advertises the writable set only for the sole all-true tuple across all 32 capability combinations", () => {
		for (let mask = 0; mask < 32; mask += 1) {
			const platformCapabilities: WorkspaceCapabilities = Object.freeze({
				create: (mask & 1) !== 0,
				renameNoReplace: (mask & 2) !== 0,
				copyMove: (mask & 4) !== 0,
				delete: (mask & 8) !== 0,
				versionedWrite: (mask & 16) !== 0,
			});
			const provider = createPlainWorkspaceFileSystemProvider(
				testBridge(),
				platformCapabilities,
			);
			const expected =
				mask === 31
					? FileSystemProviderCapabilities.FileReadWrite |
						FileSystemProviderCapabilities.FileFolderCopy
					: FileSystemProviderCapabilities.FileReadWrite |
						FileSystemProviderCapabilities.Readonly;

			expect(provider.capabilities, `capability mask ${mask}`).toBe(expected);
			expect(provider.onDidChangeCapabilities).toBe(Event.None);
			expect(
				provider.capabilities &
					FileSystemProviderCapabilities.PathCaseSensitive,
			).toBe(0);
		}
	});

	it("seals the native bridge, mutation policy, capability bits and provider prototype at runtime", async () => {
		const readonlyCreate = vi.fn();
		const writableProvider =
			createPlainWorkspaceFileSystemProvider(testBridge());
		const readonlyProvider = createPlainWorkspaceFileSystemProvider(
			testBridge({ workspaceCreateFile: readonlyCreate }),
			Object.freeze({ ...supportedCapabilities, renameNoReplace: false }),
		);

		for (const provider of [writableProvider, readonlyProvider]) {
			const ownKeys = Reflect.ownKeys(provider);
			expect(ownKeys).not.toContain("bridge");
			expect(ownKeys).not.toContain("allowsMutationDispatch");
			expect(Object.isFrozen(provider)).toBe(true);
			expect(Object.isFrozen(Object.getPrototypeOf(provider))).toBe(true);
			expect(Reflect.set(provider, "capabilities", 10)).toBe(false);
			expect(Reflect.set(provider, "bridge", testBridge())).toBe(false);
			expect(Reflect.set(provider, "allowsMutationDispatch", true)).toBe(false);
			expect(Reflect.set(provider, "injected", true)).toBe(false);
			expect(Reflect.set(provider, "copy", async () => {})).toBe(false);
			expect(
				Reflect.set(Object.getPrototypeOf(provider), "copy", async () => {}),
			).toBe(false);
		}

		expect(writableProvider.capabilities).toBe(
			FileSystemProviderCapabilities.FileReadWrite |
				FileSystemProviderCapabilities.FileFolderCopy,
		);
		expect(readonlyProvider.capabilities).toBe(
			FileSystemProviderCapabilities.FileReadWrite |
				FileSystemProviderCapabilities.Readonly,
		);
		const error = await rejected(
			readonlyProvider.plainCreateFile(workspaceUri("still-readonly.txt")),
		);
		expect(error.code).toBe(FileSystemProviderErrorCode.NoPermissions);
		expect(readonlyCreate).not.toHaveBeenCalled();
	});

	it("snapshots one immutable all-five mutation policy and writable capability set", async () => {
		const mutableCapabilities = { ...supportedCapabilities };
		const write = vi.fn(async () =>
			Object.freeze({
				status: "written" as const,
				stat: Object.freeze({
					kind: "file" as const,
					size: 1,
					mtime: 30,
					ctime: 20,
					version: versionB,
				}),
			}),
		);
		const provider = createPlainWorkspaceFileSystemProvider(
			testBridge({ workspaceWriteFile: write }),
			mutableCapabilities,
		);
		mutableCapabilities.versionedWrite = false;

		expect(provider.capabilities).toBe(
			FileSystemProviderCapabilities.FileReadWrite |
				FileSystemProviderCapabilities.FileFolderCopy,
		);
		await expect(
			provider.plainWriteFile(
				workspaceUri("snapshot.txt"),
				new Uint8Array([1]),
				versionA,
			),
		).resolves.toMatchObject({ status: "written" });
		expect(write).toHaveBeenCalledTimes(1);
	});

	it("keeps the private mutation seam disabled when any platform capability is false", async () => {
		for (const capability of Object.keys(
			supportedCapabilities,
		) as (keyof WorkspaceCapabilities)[]) {
			const write = vi.fn();
			const createFile = vi.fn();
			const createDirectory = vi.fn();
			const copy = vi.fn();
			const rename = vi.fn();
			const move = vi.fn();
			const commitDelete = vi.fn();
			const platformCapabilities = {
				...supportedCapabilities,
				[capability]: false,
			};
			const provider = createPlainWorkspaceFileSystemProvider(
				testBridge({
					workspaceWriteFile: write,
					workspaceCreateFile: createFile,
					workspaceCreateDirectory: createDirectory,
					workspaceCopy: copy,
					workspaceRename: rename,
					workspaceMove: move,
					workspaceCommitDeleteEntry: commitDelete,
				}),
				platformCapabilities,
			);
			platformCapabilities[capability] = true;
			const changeListener = vi.fn();
			const changeSubscription = provider.onDidChangeFile(changeListener);

			const error = await rejected(
				provider.plainWriteFile(
					workspaceUri("readonly.txt"),
					new Uint8Array([1]),
					versionA,
				),
			);
			expect(error.code).toBe(FileSystemProviderErrorCode.NoPermissions);
			expect(write).not.toHaveBeenCalled();
			let uriReads = 0;
			let optionReads = 0;
			const unreadableResource = Object.create(null) as URI;
			for (const key of ["scheme", "authority", "path", "query", "fragment"]) {
				Object.defineProperty(unreadableResource, key, {
					get() {
						uriReads += 1;
						throw new Error("must not read URI");
					},
				});
			}
			const unreadableOptions = Object.create(null);
			Object.defineProperty(unreadableOptions, "overwrite", {
				enumerable: true,
				get() {
					optionReads += 1;
					throw new Error("must not read options");
				},
			});
			for (const operation of [
				provider.plainCreateFile(unreadableResource),
				provider.plainCreateDirectory(unreadableResource),
				provider.copy(
					unreadableResource,
					unreadableResource,
					unreadableOptions,
				),
				provider.rename(
					unreadableResource,
					unreadableResource,
					unreadableOptions,
				),
				provider.delete(
					unreadableResource,
					unreadableOptions as IFileDeleteOptions,
				),
			]) {
				expect((await rejected(operation)).code).toBe(
					FileSystemProviderErrorCode.NoPermissions,
				);
			}
			expect(uriReads).toBe(0);
			expect(optionReads).toBe(0);
			expect(createFile).not.toHaveBeenCalled();
			expect(createDirectory).not.toHaveBeenCalled();
			expect(copy).not.toHaveBeenCalled();
			expect(rename).not.toHaveBeenCalled();
			expect(move).not.toHaveBeenCalled();
			expect(commitDelete).not.toHaveBeenCalled();
			expect(changeListener).not.toHaveBeenCalled();
			changeSubscription.dispose();
			expect(provider.capabilities).toBe(
				FileSystemProviderCapabilities.FileReadWrite |
					FileSystemProviderCapabilities.Readonly,
			);
		}
	});

	it("rejects accessor and Proxy capability inputs without constructing a provider", () => {
		let accessorReads = 0;
		const accessorCapabilities = { ...supportedCapabilities };
		Object.defineProperty(accessorCapabilities, "copyMove", {
			enumerable: true,
			get() {
				accessorReads += 1;
				return true;
			},
		});
		let proxyReads = 0;
		const proxyCapabilities = new Proxy(
			{ ...supportedCapabilities },
			{
				get(target, property, receiver) {
					proxyReads += 1;
					return Reflect.get(target, property, receiver);
				},
			},
		);

		for (const platformCapabilities of [
			accessorCapabilities,
			proxyCapabilities,
			{ ...supportedCapabilities, extra: true } as WorkspaceCapabilities,
			{
				...supportedCapabilities,
				delete: 1,
			} as unknown as WorkspaceCapabilities,
		]) {
			expect(() =>
				createPlainWorkspaceFileSystemProvider(
					testBridge(),
					platformCapabilities,
				),
			).toThrowError(/Plain contract/u);
		}
		expect(accessorReads).toBe(0);
		expect(proxyReads).toBe(0);
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

	it("exposes one native create receipt per entry and emits only frozen target additions", async () => {
		const createFile = vi.fn(async () =>
			Object.freeze({
				kind: "file" as const,
				size: 0,
				mtime: 0,
				ctime: 0,
				version: null,
			}),
		);
		const createDirectory = vi.fn(async () =>
			Object.freeze({
				kind: "directory" as const,
				size: 0,
				mtime: 0,
				ctime: 0,
				version: null,
			}),
		);
		const provider = createPlainWorkspaceFileSystemProvider(
			testBridge({
				workspaceCreateFile: createFile,
				workspaceCreateDirectory: createDirectory,
			}),
		);
		const events: (readonly {
			readonly type: FileChangeType;
			readonly resource: URI;
		}[])[] = [];
		const subscription = provider.onDidChangeFile(
			(
				event: readonly {
					readonly type: FileChangeType;
					readonly resource: URI;
				}[],
			) => events.push(event),
		);
		const fileResource = workspaceUri("src/new.ts");
		const directoryResource = workspaceUri("src/new-folder");

		const file = await provider.plainCreateFile(fileResource);
		const directory = await provider.plainCreateDirectory(directoryResource);
		subscription.dispose();

		expect(file).toEqual({
			type: FileType.File,
			size: 0,
			mtime: 0,
			ctime: 0,
			permissions: FilePermission.Readonly,
			plainVersion: null,
		});
		expect(directory).toEqual({
			type: FileType.Directory,
			size: 0,
			mtime: 0,
			ctime: 0,
			plainVersion: null,
		});
		expect(Object.isFrozen(file)).toBe(true);
		expect(Object.isFrozen(directory)).toBe(true);
		expect(createFile).toHaveBeenCalledTimes(1);
		expect(createFile).toHaveBeenCalledWith(rootId, "src/new.ts");
		expect(createDirectory).toHaveBeenCalledTimes(1);
		expect(createDirectory).toHaveBeenCalledWith(rootId, "src/new-folder");
		expect(events).toHaveLength(2);
		for (const [index, event] of events.entries()) {
			expect(Object.isFrozen(event)).toBe(true);
			expect(event).toHaveLength(1);
			expect(Object.isFrozen(event[0])).toBe(true);
			expect(Object.isFrozen(event[0]!.resource)).toBe(true);
			expect(event[0]!.type).toBe(FileChangeType.ADDED);
			expect(event[0]!.resource).not.toBe(
				index === 0 ? fileResource : directoryResource,
			);
			expect(event[0]!.resource.toString()).toBe(
				(index === 0 ? fileResource : directoryResource).toString(),
			);
		}
	});

	it("snapshots every create URI field once before awaiting the bridge", async () => {
		let resolveCreate:
			| ((value: {
					kind: "file";
					size: number;
					mtime: number;
					ctime: number;
					version: null;
			  }) => void)
			| undefined;
		const pending = new Promise<{
			kind: "file";
			size: number;
			mtime: number;
			ctime: number;
			version: null;
		}>((resolve) => {
			resolveCreate = resolve;
		});
		const createFile = vi.fn(() => pending);
		const provider = createPlainWorkspaceFileSystemProvider(
			testBridge({ workspaceCreateFile: createFile }),
		);
		const reads = new Map<string, number>();
		const values: Record<string, string> = {
			scheme: PLAIN_WORKSPACE_SCHEME,
			authority: rootId,
			path: "/safe.txt",
			query: "",
			fragment: "",
		};
		const hostile = Object.create(null) as URI;
		for (const key of Object.keys(values)) {
			Object.defineProperty(hostile, key, {
				get() {
					reads.set(key, (reads.get(key) ?? 0) + 1);
					return values[key];
				},
			});
		}
		const events: string[] = [];
		const subscription = provider.onDidChangeFile(
			(
				event: readonly {
					readonly type: FileChangeType;
					readonly resource: URI;
				}[],
			) => events.push(event[0]!.resource.toString()),
		);

		const operation = provider.plainCreateFile(hostile);
		values.authority = "00000000-0000-4000-8000-000000000999";
		values.path = "/private.txt";
		resolveCreate?.({
			kind: "file",
			size: 0,
			mtime: 0,
			ctime: 0,
			version: null,
		});
		await operation;
		subscription.dispose();

		expect(Object.fromEntries(reads)).toEqual({
			scheme: 1,
			authority: 1,
			path: 1,
			query: 1,
			fragment: 1,
		});
		expect(createFile).toHaveBeenCalledWith(rootId, "safe.txt");
		expect(events).toEqual([`${rootUri}safe.txt`]);
	});

	it("fails closed on create violations and rescans only ambiguous outcomes", async () => {
		const cases = [
			[
				async () => ({
					kind: "directory" as const,
					size: 0,
					mtime: 0,
					ctime: 0,
					version: null,
				}),
				FileSystemProviderErrorCode.Unavailable,
				true,
			],
			[
				async () => ({
					kind: "file" as const,
					size: 1,
					mtime: 0,
					ctime: 0,
					version: null,
				}),
				FileSystemProviderErrorCode.Unavailable,
				true,
			],
			[
				async () => ({
					kind: "file" as const,
					size: 0,
					mtime: 1,
					ctime: 0,
					version: null,
				}),
				FileSystemProviderErrorCode.Unavailable,
				true,
			],
			[
				async () => ({
					kind: "file" as const,
					size: 0,
					mtime: 0,
					ctime: 1,
					version: null,
				}),
				FileSystemProviderErrorCode.Unavailable,
				true,
			],
			[
				async () => ({
					kind: "file" as const,
					size: 0,
					mtime: 0,
					ctime: 0,
					version: versionB,
				}),
				FileSystemProviderErrorCode.Unavailable,
				true,
			],
			[
				async () => {
					throw commandError("ENTRY_ALREADY_EXISTS");
				},
				FileSystemProviderErrorCode.FileExists,
				false,
			],
			[
				async () => {
					throw commandError("ENTRY_NOT_FOUND");
				},
				FileSystemProviderErrorCode.FileNotFound,
				false,
			],
			[
				async () => {
					throw commandError("PERMISSION_DENIED");
				},
				FileSystemProviderErrorCode.NoPermissions,
				false,
			],
			[
				async () => {
					throw commandError("ROOT_UNAVAILABLE");
				},
				FileSystemProviderErrorCode.Unavailable,
				false,
			],
			[
				async () => {
					throw commandError("IO_FAILED");
				},
				FileSystemProviderErrorCode.Unavailable,
				true,
			],
			[
				async () => {
					const hostile = Object.create(null);
					Object.defineProperty(hostile, "code", {
						get() {
							throw new Error("secret /Users/private/error-code");
						},
					});
					throw hostile;
				},
				FileSystemProviderErrorCode.Unavailable,
				true,
			],
		] as const;

		for (const [createFile, expectedCode, expectsRescan] of cases) {
			const provider = createPlainWorkspaceFileSystemProvider(
				testBridge({ workspaceCreateFile: createFile }),
			);
			const events: (readonly {
				readonly type: FileChangeType;
				readonly resource: URI;
			}[])[] = [];
			const subscription = provider.onDidChangeFile(
				(
					event: readonly {
						readonly type: FileChangeType;
						readonly resource: URI;
					}[],
				) => events.push(event),
			);
			const error = await rejected(
				provider.plainCreateFile(workspaceUri("private.txt")),
			);
			subscription.dispose();
			expect(error.code).toBe(expectedCode);
			expect(error.message).not.toContain("/Users/private");
			if (expectsRescan) {
				expect(events).toHaveLength(1);
				expect(Object.isFrozen(events[0])).toBe(true);
				expect(events[0]).toHaveLength(1);
				expect(Object.isFrozen(events[0]![0])).toBe(true);
				expect(Object.isFrozen(events[0]![0]!.resource)).toBe(true);
				expect(events[0]![0]!.type).toBe(FileChangeType.UPDATED);
				expect(events[0]![0]!.resource.toString()).toBe(rootUri);
			} else {
				expect(events).toEqual([]);
			}
		}
	});

	it("rejects root and noncanonical mutation URIs before native create", async () => {
		const createFile = vi.fn();
		const createDirectory = vi.fn();
		const provider = createPlainWorkspaceFileSystemProvider(
			testBridge({
				workspaceCreateFile: createFile,
				workspaceCreateDirectory: createDirectory,
			}),
		);
		const changeListener = vi.fn();
		const subscription = provider.onDidChangeFile(changeListener);
		const hostilePath = hostileNonPrimitivePathUri();
		const invalid = [
			workspaceUri(),
			workspaceUri("entry").with({ query: "private" }),
			workspaceUri("entry").with({ fragment: "private" }),
			URI.from({
				scheme: PLAIN_WORKSPACE_SCHEME,
				authority: rootId,
				path: "/entry/",
			}),
			hostilePath.resource,
		];

		for (const resource of invalid) {
			for (const operation of [
				provider.plainCreateFile(resource),
				provider.plainCreateDirectory(resource),
			]) {
				expect((await rejected(operation)).code).toBe(
					FileSystemProviderErrorCode.NoPermissions,
				);
			}
		}
		expect(createFile).not.toHaveBeenCalled();
		expect(createDirectory).not.toHaveBeenCalled();
		expect(hostilePath.methodReads()).toBe(0);
		expect(changeListener).not.toHaveBeenCalled();
		subscription.dispose();
	});

	it("routes copy, same-root rename, and cross-root move through one native bridge each", async () => {
		const copy = vi.fn(async () => undefined);
		const rename = vi.fn(async () => undefined);
		const move = vi.fn(async () => Object.freeze({ status: "moved" as const }));
		const provider = createPlainWorkspaceFileSystemProvider(
			testBridge({
				workspaceCopy: copy,
				workspaceRename: rename,
				workspaceMove: move,
			}),
		);
		const events: (readonly {
			readonly type: FileChangeType;
			readonly resource: URI;
		}[])[] = [];
		const subscription = provider.onDidChangeFile((event: ProviderChanges) =>
			events.push(event),
		);
		const source = workspaceUri("src/main.ts");
		const sameRootCopy = workspaceUri("src/main-copy.ts");
		const crossRootCopy = rootedWorkspaceUri(targetRootId, "copied/main.ts");
		const sameRootRenameSource = workspaceUri("src/old.ts");
		const sameRootRenameTarget = workspaceUri("src/new.ts");
		const crossRootMoveSource = workspaceUri("move/source.ts");
		const crossRootMoveTarget = rootedWorkspaceUri(
			targetRootId,
			"move/target.ts",
		);

		await provider.copy(source, sameRootCopy, { overwrite: false });
		await provider.copy(source, crossRootCopy, { overwrite: false });
		await provider.rename(sameRootRenameSource, sameRootRenameTarget, {
			overwrite: false,
		});
		await provider.rename(crossRootMoveSource, crossRootMoveTarget, {
			overwrite: false,
		});
		subscription.dispose();

		expect(copy.mock.calls).toEqual([
			[rootId, "src/main.ts", rootId, "src/main-copy.ts"],
			[rootId, "src/main.ts", targetRootId, "copied/main.ts"],
		]);
		expect(rename.mock.calls).toEqual([[rootId, "src/old.ts", "src/new.ts"]]);
		expect(move.mock.calls).toEqual([
			[rootId, "move/source.ts", targetRootId, "move/target.ts"],
		]);
		expect(events).toHaveLength(4);
		expect(
			events.map((event) =>
				event.map(({ type, resource }) => [type, resource.toString()]),
			),
		).toEqual([
			[[FileChangeType.ADDED, sameRootCopy.toString()]],
			[[FileChangeType.ADDED, crossRootCopy.toString()]],
			[
				[FileChangeType.DELETED, sameRootRenameSource.toString()],
				[FileChangeType.ADDED, sameRootRenameTarget.toString()],
			],
			[
				[FileChangeType.DELETED, crossRootMoveSource.toString()],
				[FileChangeType.ADDED, crossRootMoveTarget.toString()],
			],
		]);
		for (const event of events) {
			expect(Object.isFrozen(event)).toBe(true);
			for (const change of event) {
				expect(Object.isFrozen(change)).toBe(true);
				expect(Object.isFrozen(change.resource)).toBe(true);
			}
		}
	});

	it("treats equal relative paths in different roots as distinct mutation resources", async () => {
		const copy = vi.fn(async () => undefined);
		const move = vi.fn(async () => Object.freeze({ status: "moved" as const }));
		const rename = vi.fn();
		const provider = createPlainWorkspaceFileSystemProvider(
			testBridge({
				workspaceCopy: copy,
				workspaceRename: rename,
				workspaceMove: move,
			}),
		);
		const source = workspaceUri("shared/name.ts");
		const target = rootedWorkspaceUri(targetRootId, "shared/name.ts");

		await provider.copy(source, target, { overwrite: false });
		await provider.rename(source, target, { overwrite: false });

		expect(copy).toHaveBeenCalledWith(
			rootId,
			"shared/name.ts",
			targetRootId,
			"shared/name.ts",
		);
		expect(move).toHaveBeenCalledWith(
			rootId,
			"shared/name.ts",
			targetRootId,
			"shared/name.ts",
		);
		expect(rename).not.toHaveBeenCalled();
	});

	it("snapshots both copy URIs before awaiting native work", async () => {
		let resolveCopy: (() => void) | undefined;
		const pending = new Promise<void>((resolve) => {
			resolveCopy = resolve;
		});
		const copy = vi.fn(() => pending);
		const provider = createPlainWorkspaceFileSystemProvider(
			testBridge({ workspaceCopy: copy }),
		);
		const sourceValues: Record<string, string> = {
			scheme: PLAIN_WORKSPACE_SCHEME,
			authority: rootId,
			path: "/safe/source.ts",
			query: "",
			fragment: "",
		};
		const targetValues: Record<string, string> = {
			scheme: PLAIN_WORKSPACE_SCHEME,
			authority: targetRootId,
			path: "/safe/target.ts",
			query: "",
			fragment: "",
		};
		const sourceReads = new Map<string, number>();
		const targetReads = new Map<string, number>();
		const hostileUri = (
			values: Record<string, string>,
			reads: Map<string, number>,
		): URI => {
			const resource = Object.create(null) as URI;
			for (const key of Object.keys(values)) {
				Object.defineProperty(resource, key, {
					get() {
						reads.set(key, (reads.get(key) ?? 0) + 1);
						return values[key];
					},
				});
			}
			return resource;
		};
		const source = hostileUri(sourceValues, sourceReads);
		const target = hostileUri(targetValues, targetReads);
		const options = { overwrite: false };
		const events: string[] = [];
		const subscription = provider.onDidChangeFile((event: ProviderChanges) =>
			events.push(event[0]!.resource.toString()),
		);

		const operation = provider.copy(source, target, options);
		sourceValues.authority = targetRootId;
		sourceValues.path = "/private/source.ts";
		targetValues.authority = rootId;
		targetValues.path = "/private/target.ts";
		options.overwrite = true;
		resolveCopy?.();
		await operation;
		subscription.dispose();

		const expectedReads = {
			scheme: 1,
			authority: 1,
			path: 1,
			query: 1,
			fragment: 1,
		};
		expect(Object.fromEntries(sourceReads)).toEqual(expectedReads);
		expect(Object.fromEntries(targetReads)).toEqual(expectedReads);
		expect(copy).toHaveBeenCalledWith(
			rootId,
			"safe/source.ts",
			targetRootId,
			"safe/target.ts",
		);
		expect(events).toEqual([
			`${PLAIN_WORKSPACE_SCHEME}://${targetRootId}/safe/target.ts`,
		]);
	});

	it("accepts only own-data no-overwrite options before copy or rename dispatch", async () => {
		const copy = vi.fn(async () => undefined);
		const rename = vi.fn(async () => undefined);
		const move = vi.fn();
		const provider = createPlainWorkspaceFileSystemProvider(
			testBridge({
				workspaceCopy: copy,
				workspaceRename: rename,
				workspaceMove: move,
			}),
		);
		let accessorReads = 0;
		const accessorOptions = Object.create(null);
		Object.defineProperty(accessorOptions, "overwrite", {
			enumerable: true,
			get() {
				accessorReads += 1;
				return false;
			},
		});
		let proxyReads = 0;
		const proxyOptions = new Proxy(
			{ overwrite: false },
			{
				get(target, property, receiver) {
					proxyReads += 1;
					return Reflect.get(target, property, receiver);
				},
			},
		);
		const symbolOptions = { overwrite: false } as Record<PropertyKey, unknown>;
		symbolOptions[Symbol("extra")] = true;
		const invalidOptions = [
			{},
			{ overwrite: true },
			{ overwrite: undefined },
			{ overwrite: null },
			{ overwrite: 0 },
			{ overwrite: false, extra: true },
			Object.create({ overwrite: false }),
			accessorOptions,
			proxyOptions,
			symbolOptions,
			new Boolean(false),
		] as unknown as IFileOverwriteOptions[];

		for (const options of invalidOptions) {
			for (const operation of [
				provider.copy(
					workspaceUri("source.ts"),
					workspaceUri("copy.ts"),
					options,
				),
				provider.rename(
					workspaceUri("source.ts"),
					workspaceUri("renamed.ts"),
					options,
				),
			]) {
				expect((await rejected(operation)).code).toBe(
					FileSystemProviderErrorCode.NoPermissions,
				);
			}
		}
		expect(accessorReads).toBe(0);
		expect(proxyReads).toBe(0);
		expect(copy).not.toHaveBeenCalled();
		expect(rename).not.toHaveBeenCalled();
		expect(move).not.toHaveBeenCalled();

		const nullPrototypeOptions = Object.assign(Object.create(null), {
			overwrite: false,
		}) as IFileOverwriteOptions;
		await provider.copy(
			workspaceUri("source.ts"),
			workspaceUri("copy.ts"),
			nullPrototypeOptions,
		);
		expect(copy).toHaveBeenCalledTimes(1);
	});

	it("rejects invalid mutation URIs and equal resources before native dispatch", async () => {
		const copy = vi.fn();
		const rename = vi.fn();
		const move = vi.fn();
		const provider = createPlainWorkspaceFileSystemProvider(
			testBridge({
				workspaceCopy: copy,
				workspaceRename: rename,
				workspaceMove: move,
			}),
		);
		const changeListener = vi.fn();
		const subscription = provider.onDidChangeFile(changeListener);
		const hostilePath = hostileNonPrimitivePathUri();
		const invalid = [
			workspaceUri(),
			workspaceUri("entry").with({ query: "private" }),
			workspaceUri("entry").with({ fragment: "private" }),
			workspaceUri("entry/"),
			URI.parse(`file://${rootId}/entry`),
			URI.parse(
				`${PLAIN_WORKSPACE_SCHEME}://00000000-0000-3000-8000-000000000101/entry`,
			),
			hostilePath.resource,
		];

		for (const resource of invalid) {
			for (const operation of [
				provider.copy(resource, workspaceUri("target"), {
					overwrite: false,
				}),
				provider.rename(workspaceUri("source"), resource, {
					overwrite: false,
				}),
			]) {
				expect((await rejected(operation)).code).toBe(
					FileSystemProviderErrorCode.NoPermissions,
				);
			}
		}
		for (const operation of [
			provider.copy(workspaceUri("same"), workspaceUri("same"), {
				overwrite: false,
			}),
			provider.rename(workspaceUri("same"), workspaceUri("same"), {
				overwrite: false,
			}),
		]) {
			expect((await rejected(operation)).code).toBe(
				FileSystemProviderErrorCode.FileExists,
			);
		}
		expect(copy).not.toHaveBeenCalled();
		expect(rename).not.toHaveBeenCalled();
		expect(move).not.toHaveBeenCalled();
		expect(hostilePath.methodReads()).toBe(0);
		expect(changeListener).not.toHaveBeenCalled();
		subscription.dispose();
	});

	it("rescans both roots before rejecting every published incomplete move", async () => {
		const reasons = [
			"sourceChanged",
			"targetChanged",
			"sourceUnverifiable",
			"targetUnverifiable",
			"deleteFailed",
		] as const;
		const outcomes: WorkspaceMoveResult[] = [];
		for (const [index, reason] of reasons.entries()) {
			outcomes.push(
				Object.freeze({
					status: "targetPublishedSourceRetained",
					reason,
				}),
				Object.freeze({
					status: "targetPublishedSourcePartiallyDeleted",
					reason,
					removedEntries: index === 0 ? 1 : 10_000,
				}),
			);
		}
		let outcomeIndex = 0;
		const move = vi.fn(async () => outcomes[outcomeIndex++]!);
		const rename = vi.fn();
		const copy = vi.fn();
		const provider = createPlainWorkspaceFileSystemProvider(
			testBridge({
				workspaceCopy: copy,
				workspaceRename: rename,
				workspaceMove: move,
			}),
		);
		const events: (readonly {
			readonly type: FileChangeType;
			readonly resource: URI;
		}[])[] = [];
		const order: string[] = [];
		const subscription = provider.onDidChangeFile((event: ProviderChanges) => {
			order.push("event");
			events.push(event);
		});
		const source = workspaceUri("move/source");
		const target = rootedWorkspaceUri(targetRootId, "move/target");

		for (const outcome of outcomes) {
			const operation = provider
				.rename(source, target, { overwrite: false })
				.catch((error: unknown) => {
					order.push("reject");
					throw error;
				});
			const error = await rejected(operation);
			expect(error).toMatchObject({
				code: "WORKSPACE_MOVE_INCOMPLETE",
				name: "WORKSPACE_MOVE_INCOMPLETE",
				fileOperationResult: FileOperationResult.FILE_OTHER_ERROR,
			});
			expect(error.code).not.toBe("WORKSPACE_MOVE_OUTCOME_UNKNOWN");
			expect(Object.isFrozen(error)).toBe(true);
			expect(error.message).toContain("published its target");
			expect(error.message).not.toContain("outcome is unknown");
			expect(error.message).not.toContain(outcome.status);
			if ("reason" in outcome) {
				expect(error.message).not.toContain(outcome.reason);
			}
		}
		subscription.dispose();

		expect(move).toHaveBeenCalledTimes(outcomes.length);
		expect(rename).not.toHaveBeenCalled();
		expect(copy).not.toHaveBeenCalled();
		expect(order).toEqual(outcomes.flatMap(() => ["event", "reject"]));
		expect(events).toHaveLength(outcomes.length);
		for (const event of events) {
			expect(Object.isFrozen(event)).toBe(true);
			expect(
				event.map(({ type, resource }) => [type, resource.toString()]),
			).toEqual([
				[FileChangeType.UPDATED, rootUri],
				[
					FileChangeType.UPDATED,
					`${PLAIN_WORKSPACE_SCHEME}://${targetRootId}/`,
				],
			]);
			for (const change of event) {
				expect(Object.isFrozen(change)).toBe(true);
				expect(Object.isFrozen(change.resource)).toBe(true);
			}
		}
	});

	it("rescans both roots before rejecting every unknown move outcome", async () => {
		const privatePath = "/Users/private/workspace";
		const scenarios = [
			{
				label: "transport rejection",
				bridge: testBridge({
					async workspaceMove() {
						throw new Error(`Transport rejected at ${privatePath}`);
					},
				}),
				secrets: ["Transport rejected", privatePath],
			},
			{
				label: "malformed response",
				bridge: testBridge({
					async workspaceMove() {
						return Object.freeze({
							status: "moved",
							details: privatePath,
						}) as never;
					},
				}),
				secrets: ["details", privatePath],
			},
			{
				label: "unauthenticated command error",
				bridge: testBridge({
					async workspaceMove() {
						throw Object.freeze({
							code: "IO_FAILED",
							message: `Native move failed at ${privatePath}`,
							details: privatePath,
						});
					},
				}),
				secrets: ["IO_FAILED", "Native move failed", privatePath],
			},
		] as const;
		const source = workspaceUri("unknown/source");
		const target = rootedWorkspaceUri(targetRootId, "unknown/target");

		for (const scenario of scenarios) {
			const provider = createPlainWorkspaceFileSystemProvider(scenario.bridge);
			const order: string[] = [];
			const events: ProviderChanges[] = [];
			const subscription = provider.onDidChangeFile(
				(event: ProviderChanges) => {
					order.push("event");
					events.push(event);
				},
			);
			const operation = provider
				.rename(source, target, { overwrite: false })
				.catch((error: unknown) => {
					order.push("reject");
					throw error;
				});
			const error = await rejected(operation);
			subscription.dispose();

			expect(error, scenario.label).toMatchObject({
				code: "WORKSPACE_MOVE_OUTCOME_UNKNOWN",
				name: "WORKSPACE_MOVE_OUTCOME_UNKNOWN",
				fileOperationResult: FileOperationResult.FILE_OTHER_ERROR,
			});
			expect(error.code).not.toBe("WORKSPACE_MOVE_INCOMPLETE");
			expect(Object.isFrozen(error)).toBe(true);
			expect(error.message).toContain("outcome is unknown");
			expect(error.message).toContain("source and target");
			expect(error.message).toContain("were refreshed");
			expect(error.message).toContain("check both locations");
			expect(error.message).not.toContain("published");
			for (const secret of scenario.secrets) {
				expect(error.message).not.toContain(secret);
			}
			expect(order).toEqual(["event", "reject"]);
			expect(events).toHaveLength(1);
			const event = events[0]!;
			expect(Object.isFrozen(event)).toBe(true);
			expect(
				event.map(({ type, resource }) => [type, resource.toString()]),
			).toEqual([
				[FileChangeType.UPDATED, rootUri],
				[
					FileChangeType.UPDATED,
					`${PLAIN_WORKSPACE_SCHEME}://${targetRootId}/`,
				],
			]);
			for (const change of event) {
				expect(Object.isFrozen(change)).toBe(true);
				expect(Object.isFrozen(change.resource)).toBe(true);
			}
		}
	});

	it("rescans only affected roots when copy or move responses cannot be authenticated", async () => {
		const source = workspaceUri("unknown/source");
		const sameRootTarget = workspaceUri("unknown/target");
		const crossRootTarget = rootedWorkspaceUri(targetRootId, "unknown/target");
		let errorCodeReads = 0;
		const accessorError = Object.create(null);
		Object.defineProperties(accessorError, {
			code: {
				enumerable: true,
				get() {
					errorCodeReads += 1;
					return "ENTRY_NOT_FOUND";
				},
			},
			message: {
				enumerable: true,
				value: "Private failure at /Users/private/workspace",
			},
		});
		const cases = [
			{
				bridge: testBridge({
					async workspaceCopy() {
						return null as never;
					},
				}),
				invoke: "copy" as const,
				target: sameRootTarget,
				expectedRoots: [rootUri],
				expectedCode: FileSystemProviderErrorCode.Unavailable,
			},
			{
				bridge: testBridge({
					async workspaceCopy() {
						throw accessorError;
					},
				}),
				invoke: "copy" as const,
				target: sameRootTarget,
				expectedRoots: [rootUri],
				expectedCode: FileSystemProviderErrorCode.Unavailable,
			},
			{
				bridge: testBridge({
					async workspaceRename() {
						return null as never;
					},
				}),
				invoke: "rename" as const,
				target: sameRootTarget,
				expectedRoots: [rootUri],
				expectedCode: FileSystemProviderErrorCode.Unavailable,
			},
			{
				bridge: testBridge({
					async workspaceMove() {
						return Object.freeze({ status: "moved", extra: true }) as never;
					},
				}),
				invoke: "rename" as const,
				target: crossRootTarget,
				expectedRoots: [
					rootUri,
					`${PLAIN_WORKSPACE_SCHEME}://${targetRootId}/`,
				],
				expectedCode: "WORKSPACE_MOVE_OUTCOME_UNKNOWN",
			},
			{
				bridge: testBridge({
					async workspaceMove() {
						throw exactCommandError("IO_FAILED");
					},
				}),
				invoke: "rename" as const,
				target: crossRootTarget,
				expectedRoots: [
					rootUri,
					`${PLAIN_WORKSPACE_SCHEME}://${targetRootId}/`,
				],
				expectedCode: "WORKSPACE_MOVE_OUTCOME_UNKNOWN",
			},
		] as const;

		for (const scenario of cases) {
			const provider = createPlainWorkspaceFileSystemProvider(scenario.bridge);
			const events: (readonly {
				readonly type: FileChangeType;
				readonly resource: URI;
			}[])[] = [];
			const subscription = provider.onDidChangeFile((event: ProviderChanges) =>
				events.push(event),
			);
			const operation =
				scenario.invoke === "copy"
					? provider.copy(source, scenario.target, { overwrite: false })
					: provider.rename(source, scenario.target, { overwrite: false });
			const error = await rejected(operation);
			subscription.dispose();

			expect(error.code).toBe(scenario.expectedCode);
			expect(events).toHaveLength(1);
			expect(
				events[0]!.map(({ type, resource }) => [type, resource.toString()]),
			).toEqual(
				scenario.expectedRoots.map((resource) => [
					FileChangeType.UPDATED,
					resource,
				]),
			);
		}
		expect(errorCodeReads).toBe(0);
	});

	it("maps exact prepublication copy and move errors without publishing changes", async () => {
		const mappings = [
			["ENTRY_ALREADY_EXISTS", FileSystemProviderErrorCode.FileExists],
			["ENTRY_NOT_FOUND", FileSystemProviderErrorCode.FileNotFound],
			["ENTRY_TYPE_MISMATCH", FileSystemProviderErrorCode.FileNotADirectory],
			["ROOT_NOT_AUTHORIZED", FileSystemProviderErrorCode.NoPermissions],
			["INVALID_RELATIVE_PATH", FileSystemProviderErrorCode.NoPermissions],
			["PATH_OUTSIDE_ROOT", FileSystemProviderErrorCode.NoPermissions],
			["PERMISSION_DENIED", FileSystemProviderErrorCode.NoPermissions],
			["ROOT_UNAVAILABLE", FileSystemProviderErrorCode.Unavailable],
			["PATH_ENCODING_UNSUPPORTED", FileSystemProviderErrorCode.Unavailable],
			["WORKSPACE_CONFLICT", FileSystemProviderErrorCode.Unavailable],
			["WORKSPACE_WINDOW_CLOSED", FileSystemProviderErrorCode.Unavailable],
			["DIRECTORY_TOO_LARGE", FileSystemProviderErrorCode.FileTooLarge],
			["FILE_TOO_LARGE", FileSystemProviderErrorCode.FileTooLarge],
		] as const;

		for (const [nativeCode, expectedCode] of mappings) {
			const provider = createPlainWorkspaceFileSystemProvider(
				testBridge({
					async workspaceCopy() {
						throw Object.freeze({
							code: nativeCode,
							message: "Native failure at /Users/private/workspace",
						});
					},
				}),
			);
			const changeListener = vi.fn();
			const subscription = provider.onDidChangeFile(changeListener);
			const error = await rejected(
				provider.copy(workspaceUri("source"), workspaceUri("target"), {
					overwrite: false,
				}),
			);
			subscription.dispose();

			expect(error.code).toBe(expectedCode);
			expect(error.message).not.toContain("/Users/private");
			expect(error.message).not.toContain(nativeCode);
			expect(changeListener).not.toHaveBeenCalled();
		}

		const provider = createPlainWorkspaceFileSystemProvider(
			testBridge({
				async workspaceMove() {
					throw exactCommandError("ENTRY_NOT_FOUND");
				},
			}),
		);
		const changeListener = vi.fn();
		const subscription = provider.onDidChangeFile(changeListener);
		const error = await rejected(
			provider.rename(
				workspaceUri("source"),
				rootedWorkspaceUri(targetRootId, "target"),
				{ overwrite: false },
			),
		);
		subscription.dispose();
		expect(error.code).toBe(FileSystemProviderErrorCode.FileNotFound);
		expect(error.code).not.toBe("WORKSPACE_MOVE_INCOMPLETE");
		expect(error.code).not.toBe("WORKSPACE_MOVE_OUTCOME_UNKNOWN");
		expect(changeListener).not.toHaveBeenCalled();
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

	it("consumes one exact confirmed-delete authorization, commits once, and emits only the deleted entry", async () => {
		const commit = vi.fn(async () =>
			Object.freeze({ status: "deleted" as const }),
		);
		const provider = createPlainWorkspaceFileSystemProvider(
			testBridge({ workspaceCommitDeleteEntry: commit }),
		);
		const resource = workspaceUri("delete-me.txt");
		const authorized = authorizedProviderDelete(resource);
		const changes: ProviderChanges[] = [];
		const subscription = provider.onDidChangeFile((event: ProviderChanges) =>
			changes.push(event),
		);

		await expect(
			provider.delete(resource, authorized.options),
		).resolves.toBeUndefined();
		subscription.dispose();

		expect(commit).toHaveBeenCalledOnce();
		expect(commit).toHaveBeenCalledWith(
			"00000000-0000-4000-8000-000000000303",
			"00000000-0000-4000-8000-000000000404",
			rootId,
			"delete-me.txt",
			true,
		);
		expect(getPlainWorkspaceDeleteState(authorized.authorization)).toEqual({
			status: "deleted",
		});
		expect(changes).toHaveLength(1);
		expect(changes[0]).toHaveLength(1);
		expect(changes[0]![0]).toMatchObject({
			type: FileChangeType.DELETED,
		});
		expect(changes[0]![0]!.resource.toString()).toBe(resource.toString());
		expect(provider.capabilities).toBe(
			FileSystemProviderCapabilities.FileReadWrite |
				FileSystemProviderCapabilities.FileFolderCopy,
		);

		const replay = await rejected(
			provider.delete(resource, authorized.options),
		);
		expect(replay.code).toBe(FileSystemProviderErrorCode.NoPermissions);
		expect(commit).toHaveBeenCalledOnce();
	});

	it("publishes a root rescan before mapping every retained or partial terminal to unavailable", async () => {
		for (const result of [
			Object.freeze({
				status: "entryRetained" as const,
				reason: "entryChanged" as const,
			}),
			Object.freeze({
				status: "entryPartiallyDeleted" as const,
				reason: "deleteFailed" as const,
				removedEntries: 10_000,
			}),
		]) {
			const provider = createPlainWorkspaceFileSystemProvider(
				testBridge({
					async workspaceCommitDeleteEntry() {
						return result;
					},
				}),
			);
			const resource = workspaceUri("tree");
			const authorized = authorizedProviderDelete(resource, "directory");
			const order: string[] = [];
			const subscription = provider.onDidChangeFile(
				(event: ProviderChanges) => {
					order.push("event");
					expect(event).toHaveLength(1);
					expect(event[0]!.type).toBe(FileChangeType.UPDATED);
					expect(event[0]!.resource.toString()).toBe(rootUri);
				},
			);

			const error = await rejected(
				provider.delete(resource, authorized.options).catch((candidate) => {
					order.push("error");
					throw candidate;
				}),
			);
			subscription.dispose();
			expect(error.code).toBe(FileSystemProviderErrorCode.Unavailable);
			expect(order).toEqual(["event", "error"]);
			expect(getPlainWorkspaceDeleteState(authorized.authorization)).toEqual(
				result,
			);
		}
	});

	it("separates the closed pre-syscall ordinary set from response-unknown failures and never replays either", async () => {
		for (const code of [
			"ROOT_NOT_AUTHORIZED",
			"ROOT_UNAVAILABLE",
			"INVALID_RELATIVE_PATH",
			"ENTRY_TYPE_MISMATCH",
			"WORKSPACE_CONFLICT",
			"WORKSPACE_WINDOW_CLOSED",
			"WORKSPACE_DELETE_PLAN_INVALID",
		]) {
			const commit = vi.fn(async () => {
				throw exactCommandError(code);
			});
			const provider = createPlainWorkspaceFileSystemProvider(
				testBridge({ workspaceCommitDeleteEntry: commit }),
			);
			const resource = workspaceUri(`ordinary-${code}.txt`);
			const authorized = authorizedProviderDelete(resource);
			const changes = vi.fn();
			const subscription = provider.onDidChangeFile(changes);

			await expect(
				provider.delete(resource, authorized.options),
			).rejects.toBeDefined();
			expect(getPlainWorkspaceDeleteState(authorized.authorization)).toEqual({
				status: "ordinaryFailure",
			});
			expect(changes).not.toHaveBeenCalled();
			await expect(
				provider.delete(resource, authorized.options),
			).rejects.toMatchObject({
				code: FileSystemProviderErrorCode.NoPermissions,
			});
			expect(commit).toHaveBeenCalledOnce();
			subscription.dispose();
		}

		for (const failure of [
			commandError("IO_FAILED"),
			Object.freeze({
				code: "WORKSPACE_DELETE_BATCH_CHANGED",
				message: "Unexpected commit rejection.",
			}),
			new Error("transport lost"),
		]) {
			const provider = createPlainWorkspaceFileSystemProvider(
				testBridge({
					async workspaceCommitDeleteEntry() {
						throw failure;
					},
				}),
			);
			const resource = workspaceUri("unknown.txt");
			const authorized = authorizedProviderDelete(resource);
			const changes: ProviderChanges[] = [];
			const subscription = provider.onDidChangeFile((event: ProviderChanges) =>
				changes.push(event),
			);

			await expect(
				provider.delete(resource, authorized.options),
			).rejects.toMatchObject({
				code: FileSystemProviderErrorCode.Unavailable,
			});
			subscription.dispose();
			expect(getPlainWorkspaceDeleteState(authorized.authorization)).toEqual({
				status: "outcomeUnknown",
			});
			expect(changes).toHaveLength(1);
			expect(changes[0]![0]!.type).toBe(FileChangeType.UPDATED);
			expect(changes[0]![0]!.resource.toString()).toBe(rootUri);
		}
	});

	it("keeps generic write, mkdir, and delete operations unavailable", async () => {
		const provider = createPlainWorkspaceFileSystemProvider(testBridge());
		const from = workspaceUri("from");

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
		]) {
			const error = await rejected(operation);
			expect(error.code).toBe(FileSystemProviderErrorCode.NoPermissions);
			expect(error.message).toBe("The workspace entry cannot be accessed.");
		}
	});

	it("routes supported and readonly watches through the same root-scoped bridge and disposes once", () => {
		const watchListeners: Array<() => void> = [];
		const unlisteners: Array<ReturnType<typeof vi.fn>> = [];
		const workspaceWatch = vi.fn(
			(watchedRootId: string, listener: () => void) => {
				watchListeners.push(listener);
				const unlisten = vi.fn();
				unlisteners.push(unlisten);
				return unlisten;
			},
		);
		const bridge = testBridge({ workspaceWatch });
		const readonlyCapabilities = Object.freeze({
			create: false,
			renameNoReplace: false,
			copyMove: false,
			delete: false,
			versionedWrite: false,
		});

		for (const capabilities of [supportedCapabilities, readonlyCapabilities]) {
			const provider = createPlainWorkspaceFileSystemProvider(
				bridge,
				capabilities,
			);
			const changes: ProviderChanges[] = [];
			const subscription = provider.onDidChangeFile((event: ProviderChanges) =>
				changes.push(event),
			);
			const disposable = provider.watch(workspaceUri("src"), {
				recursive: true,
				excludes: [],
			});

			watchListeners.at(-1)!();
			expect(changes).toHaveLength(1);
			expect(changes[0]).toHaveLength(1);
			expect(changes[0]![0]!.type).toBe(FileChangeType.UPDATED);
			expect(changes[0]![0]!.resource.toString()).toBe(rootUri);
			disposable.dispose();
			disposable.dispose();
			expect(unlisteners.at(-1)).toHaveBeenCalledOnce();
			subscription.dispose();
		}

		expect(workspaceWatch.mock.calls).toEqual([
			[rootId, watchListeners[0]],
			[rootId, watchListeners[1]],
		]);

		const provider = createPlainWorkspaceFileSystemProvider(bridge);
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

	describe("external delete detection via watch-state reconciliation", () => {
		const fileStat = Object.freeze({
			kind: "file" as const,
			size: 3,
			mtime: 20,
			ctime: 10,
			version: versionA,
		});

		function deferredStat(): Readonly<{
			stat: (rootId: string, relativePath: string) => Promise<unknown>;
			calls: string[];
			resolveNext(value: unknown): void;
			rejectNext(error: unknown): void;
		}> {
			const calls: string[] = [];
			const pending: Array<{
				resolve: (value: unknown) => void;
				reject: (error: unknown) => void;
			}> = [];
			return Object.freeze({
				calls,
				stat(_rootId: string, relativePath: string): Promise<unknown> {
					calls.push(relativePath);
					return new Promise((resolve, reject) => {
						pending.push({ resolve, reject });
					});
				},
				resolveNext(value: unknown): void {
					const next = pending.shift();
					if (next === undefined) {
						throw new Error("no pending stat call to resolve");
					}
					next.resolve(value);
				},
				rejectNext(error: unknown): void {
					const next = pending.shift();
					if (next === undefined) {
						throw new Error("no pending stat call to reject");
					}
					next.reject(error);
				},
			});
		}

		async function flushMicrotasks(turns = 4): Promise<void> {
			for (let turn = 0; turn < turns; turn += 1) {
				await Promise.resolve();
			}
		}

		function watchableBridge(overrides: Partial<PlainBridge> = {}): Readonly<{
			bridge: PlainBridge;
			watchListeners: Array<() => void>;
			workspaceWatch: ReturnType<typeof vi.fn>;
		}> {
			const watchListeners: Array<() => void> = [];
			const workspaceWatch = vi.fn(
				(_watchedRootId: string, listener: () => void) => {
					watchListeners.push(listener);
					return () => {};
				},
			);
			return Object.freeze({
				bridge: testBridge({ workspaceWatch, ...overrides }),
				watchListeners,
				workspaceWatch,
			});
		}

		it("fires a precise DELETED event once a previously read file's stat reports it missing, and does not refire while still missing", async () => {
			const stat = vi.fn(async (_rootId: string, relativePath: string) => {
				if (relativePath === "src/gone.ts") {
					throw exactCommandError("ENTRY_NOT_FOUND");
				}
				return fileStat;
			});
			const { bridge, watchListeners } = watchableBridge({
				workspaceStat: stat as PlainBridge["workspaceStat"],
			});
			const provider = createPlainWorkspaceFileSystemProvider(bridge);
			const changes: ProviderChanges[] = [];
			provider.onDidChangeFile((event: ProviderChanges) => changes.push(event));
			provider.watch(workspaceUri(""), { recursive: true, excludes: [] });
			const target = workspaceUri("src/gone.ts");
			await provider.plainReadFile(target);

			watchListeners.at(-1)!();
			await flushMicrotasks();

			expect(changes).toHaveLength(2);
			expect(changes[0]).toHaveLength(1);
			expect(changes[0]![0]!.type).toBe(FileChangeType.UPDATED);
			expect(changes[0]![0]!.resource.toString()).toBe(rootUri);
			expect(changes[1]).toHaveLength(1);
			expect(changes[1]![0]!.type).toBe(FileChangeType.DELETED);
			expect(changes[1]![0]!.resource.toString()).toBe(target.toString());

			watchListeners.at(-1)!();
			await flushMicrotasks();
			expect(changes).toHaveLength(3);
			expect(changes[2]![0]!.type).toBe(FileChangeType.UPDATED);
		});

		it("treats ENTRY_TYPE_MISMATCH the same as ENTRY_NOT_FOUND for a previously read path", async () => {
			const stat = vi.fn(async () => {
				throw exactCommandError("ENTRY_TYPE_MISMATCH");
			});
			const { bridge, watchListeners } = watchableBridge({
				workspaceStat: stat as PlainBridge["workspaceStat"],
			});
			const provider = createPlainWorkspaceFileSystemProvider(bridge);
			const changes: ProviderChanges[] = [];
			provider.onDidChangeFile((event: ProviderChanges) => changes.push(event));
			provider.watch(workspaceUri(""), { recursive: true, excludes: [] });
			const target = workspaceUri("src/became-a-dir.ts");
			await provider.plainReadFile(target);

			watchListeners.at(-1)!();
			await flushMicrotasks();

			expect(changes).toHaveLength(2);
			expect(changes[1]![0]!.type).toBe(FileChangeType.DELETED);
			expect(changes[1]![0]!.resource.toString()).toBe(target.toString());
		});

		it("fires ADDED and clears the missing mark once a previously deleted read file reappears", async () => {
			let missing = true;
			const stat = vi.fn(async () => {
				if (missing) {
					throw exactCommandError("ENTRY_NOT_FOUND");
				}
				return fileStat;
			});
			const { bridge, watchListeners } = watchableBridge({
				workspaceStat: stat as PlainBridge["workspaceStat"],
			});
			const provider = createPlainWorkspaceFileSystemProvider(bridge);
			const changes: ProviderChanges[] = [];
			provider.onDidChangeFile((event: ProviderChanges) => changes.push(event));
			provider.watch(workspaceUri(""), { recursive: true, excludes: [] });
			const target = workspaceUri("src/restored.ts");
			await provider.plainReadFile(target);

			watchListeners.at(-1)!();
			await flushMicrotasks();
			expect(changes).toHaveLength(2);
			expect(changes[1]![0]!.type).toBe(FileChangeType.DELETED);

			missing = false;
			watchListeners.at(-1)!();
			await flushMicrotasks();
			expect(changes).toHaveLength(4);
			expect(changes[3]).toHaveLength(1);
			expect(changes[3]![0]!.type).toBe(FileChangeType.ADDED);
			expect(changes[3]![0]!.resource.toString()).toBe(target.toString());

			watchListeners.at(-1)!();
			await flushMicrotasks();
			expect(changes).toHaveLength(5);
			expect(changes[4]![0]!.type).toBe(FileChangeType.UPDATED);
		});

		it("does not fire or mark missing when the stat recheck fails for a non-absence reason", async () => {
			for (const code of [
				"ROOT_NOT_AUTHORIZED",
				"PERMISSION_DENIED",
				"IO_FAILED",
				"WORKSPACE_CONFLICT",
			]) {
				const stat = vi.fn(async () => {
					throw exactCommandError(code);
				});
				const { bridge, watchListeners } = watchableBridge({
					workspaceStat: stat as PlainBridge["workspaceStat"],
				});
				const provider = createPlainWorkspaceFileSystemProvider(bridge);
				const changes: ProviderChanges[] = [];
				provider.onDidChangeFile((event: ProviderChanges) =>
					changes.push(event),
				);
				provider.watch(workspaceUri(""), { recursive: true, excludes: [] });
				const target = workspaceUri("src/guarded.ts");
				await provider.plainReadFile(target);

				watchListeners.at(-1)!();
				await flushMicrotasks();

				expect(changes).toHaveLength(1);
				expect(changes[0]![0]!.type).toBe(FileChangeType.UPDATED);
			}
		});

		it("only rechecks previously read resources: a root-only watch with nothing read triggers no stat calls", async () => {
			const stat = vi.fn(async () => fileStat);
			const { bridge, watchListeners } = watchableBridge({
				workspaceStat: stat as PlainBridge["workspaceStat"],
			});
			const provider = createPlainWorkspaceFileSystemProvider(bridge);
			provider.watch(workspaceUri(""), { recursive: true, excludes: [] });

			watchListeners.at(-1)!();
			await flushMicrotasks();

			expect(stat).not.toHaveBeenCalled();
		});

		it("sweeps every previously read path for a root during one wake", async () => {
			const stat = vi.fn(async (_rootId: string, relativePath: string) => {
				if (relativePath === "src/b.ts") {
					throw exactCommandError("ENTRY_NOT_FOUND");
				}
				return fileStat;
			});
			const { bridge, watchListeners } = watchableBridge({
				workspaceStat: stat as PlainBridge["workspaceStat"],
			});
			const provider = createPlainWorkspaceFileSystemProvider(bridge);
			const changes: ProviderChanges[] = [];
			provider.onDidChangeFile((event: ProviderChanges) => changes.push(event));
			provider.watch(workspaceUri(""), { recursive: true, excludes: [] });
			await provider.plainReadFile(workspaceUri("src/a.ts"));
			await provider.plainReadFile(workspaceUri("src/b.ts"));

			watchListeners.at(-1)!();
			await flushMicrotasks();

			expect(stat.mock.calls.map((call) => call[1]).sort()).toEqual([
				"src/a.ts",
				"src/b.ts",
			]);
			const deleted = changes
				.flat()
				.filter((change) => change.type === FileChangeType.DELETED);
			expect(deleted).toHaveLength(1);
			expect(deleted[0]!.resource.toString()).toBe(
				workspaceUri("src/b.ts").toString(),
			);
		});

		it("runs at most one in-flight stat sweep per root and merges a wake that arrives mid-sweep into one follow-up sweep", async () => {
			const control = deferredStat();
			const { bridge, watchListeners } = watchableBridge({
				workspaceStat: control.stat as PlainBridge["workspaceStat"],
			});
			const provider = createPlainWorkspaceFileSystemProvider(bridge);
			provider.watch(workspaceUri(""), { recursive: true, excludes: [] });
			const target = workspaceUri("src/busy.ts");
			await provider.plainReadFile(target);

			watchListeners.at(-1)!();
			await flushMicrotasks();
			expect(control.calls).toEqual(["src/busy.ts"]);

			watchListeners.at(-1)!();
			await flushMicrotasks();
			expect(control.calls).toEqual(["src/busy.ts"]);

			control.resolveNext(fileStat);
			await flushMicrotasks();
			expect(control.calls).toEqual(["src/busy.ts", "src/busy.ts"]);

			control.resolveNext(fileStat);
			await flushMicrotasks();
			expect(control.calls).toEqual(["src/busy.ts", "src/busy.ts"]);
		});

		it("bounds the tracked set per root: reading past the cap evicts the oldest untouched path but keeps a re-read path", async () => {
			const stat = vi.fn(async (_rootId: string, relativePath: string) => {
				if (
					relativePath === "src/evicted.ts" ||
					relativePath === "src/kept.ts"
				) {
					throw exactCommandError("ENTRY_NOT_FOUND");
				}
				return fileStat;
			});
			const { bridge, watchListeners } = watchableBridge({
				workspaceStat: stat as PlainBridge["workspaceStat"],
			});
			const provider = createPlainWorkspaceFileSystemProvider(bridge);
			const changes: ProviderChanges[] = [];
			provider.onDidChangeFile((event: ProviderChanges) => changes.push(event));
			provider.watch(workspaceUri(""), { recursive: true, excludes: [] });

			// "src/evicted.ts" is read first; "src/kept.ts" is read second but
			// re-read again right before the cap is exceeded, so it must not be
			// the one evicted.
			await provider.plainReadFile(workspaceUri("src/evicted.ts"));
			await provider.plainReadFile(workspaceUri("src/kept.ts"));
			for (let index = 0; index < 254; index += 1) {
				await provider.plainReadFile(workspaceUri(`src/filler-${index}.ts`));
			}
			await provider.plainReadFile(workspaceUri("src/kept.ts"));
			// Exactly one more distinct read exceeds the 256-entry bound and
			// evicts the least-recently-touched path, which is now
			// "src/evicted.ts" rather than "src/kept.ts".
			await provider.plainReadFile(workspaceUri("src/one-more.ts"));

			watchListeners.at(-1)!();
			// The reconciliation sweep awaits one bridge call per tracked path
			// sequentially, and "src/kept.ts" is last in iteration order because
			// it was re-touched; a generous flush lets the whole bounded sweep
			// (256 entries) settle before asserting.
			await flushMicrotasks(2_000);

			const deletedResources = changes
				.flat()
				.filter((change) => change.type === FileChangeType.DELETED)
				.map((change) => change.resource.toString());
			expect(deletedResources).toEqual([
				workspaceUri("src/kept.ts").toString(),
			]);
			expect(stat.mock.calls.some((call) => call[1] === "src/evicted.ts")).toBe(
				false,
			);
		});

		it("discards an in-flight stat result once the path is evicted from the tracked set before it resolves", async () => {
			const control = deferredStat();
			const { bridge, watchListeners } = watchableBridge({
				workspaceStat: control.stat as PlainBridge["workspaceStat"],
			});
			const provider = createPlainWorkspaceFileSystemProvider(bridge);
			const changes: ProviderChanges[] = [];
			provider.onDidChangeFile((event: ProviderChanges) => changes.push(event));
			provider.watch(workspaceUri(""), { recursive: true, excludes: [] });
			const target = workspaceUri("src/torn-down.ts");
			await provider.plainReadFile(target);

			watchListeners.at(-1)!();
			await flushMicrotasks();
			expect(control.calls).toEqual(["src/torn-down.ts"]);

			// Evict "src/torn-down.ts" from the tracked set by reading past the
			// per-root bound while its stat call is still in flight.
			for (let index = 0; index < 256; index += 1) {
				await provider.plainReadFile(workspaceUri(`src/filler-${index}.ts`));
			}

			control.rejectNext(exactCommandError("ENTRY_NOT_FOUND"));
			await flushMicrotasks();

			expect(
				changes.some((batch) => batch[0]!.type === FileChangeType.DELETED),
			).toBe(false);
		});
	});
});
