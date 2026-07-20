import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import {
	FilePermission,
	FileSystemProviderCapabilities,
	FileSystemProviderErrorCode,
	FileType,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files";
import { describe, expect, it, vi } from "vitest";

import {
	createPlainWorkspaceConfigurationProvider,
	PLAIN_WORKSPACE_CONFIGURATION_PATH,
	PLAIN_WORKSPACE_CONFIGURATION_SCHEME,
} from "../../app/features/workspace/workspace-configuration-provider";
import type {
	WorkspaceRoot,
	WorkspaceSnapshot,
} from "../../app/platform/tauri/contracts";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const otherWorkspaceId = "00000000-0000-4000-8000-000000000002";
const decoder = new TextDecoder();

function workspaceRoot(
	index: number,
	displayName = `root-${index}`,
): WorkspaceRoot {
	const tail = index.toString(16).padStart(12, "0");
	const rootId = `10000000-0000-4000-8000-${tail}`;
	return {
		rootId,
		displayName,
		uri: `plain-workspace://${rootId}/`,
	};
}

function workspaceSnapshot(
	revision: number,
	roots: readonly WorkspaceRoot[],
	id = workspaceId,
): WorkspaceSnapshot {
	return { workspaceId: id, revision, roots };
}

function configurationUri(id = workspaceId): URI {
	return URI.from(
		{
			scheme: PLAIN_WORKSPACE_CONFIGURATION_SCHEME,
			authority: id,
			path: PLAIN_WORKSPACE_CONFIGURATION_PATH,
		},
		true,
	);
}

async function expectProviderError(
	operation: () => unknown | Promise<unknown>,
	code: FileSystemProviderErrorCode,
): Promise<Error> {
	let error: unknown;
	try {
		await operation();
	} catch (candidate) {
		error = candidate;
	}
	expect(error).toMatchObject({ code });
	expect(error).toBeInstanceOf(Error);
	return error as Error;
}

describe("Plain generated workspace configuration provider", () => {
	it("installs one immutable readonly file with folders-only UTF-8 JSON", async () => {
		const provider = createPlainWorkspaceConfigurationProvider();
		const changes = vi.fn();
		const changeSubscription = provider.onDidChangeFile(changes);
		const root = workspaceRoot(1, "Plain 项目");

		const installation = provider.install(workspaceSnapshot(7, [root]));
		const bytes = await provider.readFile(installation.configPath);
		const stat = await provider.stat(installation.configPath);
		const document = JSON.parse(decoder.decode(bytes)) as Record<
			string,
			unknown
		>;

		expect(provider.capabilities).toBe(
			FileSystemProviderCapabilities.FileReadWrite |
				FileSystemProviderCapabilities.Readonly,
		);
		expect(
			provider.capabilities & FileSystemProviderCapabilities.FileFolderCopy,
		).toBe(0);
		expect(installation).toMatchObject({ workspaceId, revision: 7 });
		expect(installation.configPath.toString()).toBe(
			`${PLAIN_WORKSPACE_CONFIGURATION_SCHEME}://${workspaceId}${PLAIN_WORKSPACE_CONFIGURATION_PATH}`,
		);
		expect(Object.isFrozen(installation)).toBe(true);
		expect(Object.isFrozen(installation.configPath)).toBe(true);
		expect(stat).toEqual({
			type: FileType.File,
			ctime: 0,
			mtime: 0,
			size: bytes.byteLength,
			permissions: FilePermission.Readonly,
		});
		expect(Object.isFrozen(stat)).toBe(true);
		expect(Reflect.ownKeys(document)).toEqual(["folders"]);
		expect(document.folders).toEqual([
			{ uri: root.uri, name: root.displayName },
		]);
		expect(decoder.decode(bytes)).not.toMatch(
			/"(?:transient|settings|tasks|launch|extensions)"/u,
		);
		expect(changes).not.toHaveBeenCalled();

		bytes.fill(0);
		const reread = await provider.readFile(installation.configPath);
		expect(JSON.parse(decoder.decode(reread))).toEqual(document);
		expect(reread).not.toBe(bytes);
		changeSubscription.dispose();
	});

	it("preserves Rust root order and names for two roots at a stable config URI", async () => {
		const provider = createPlainWorkspaceConfigurationProvider();
		const first = workspaceRoot(1, "same-name");
		const second = workspaceRoot(2, "same-name");
		const initial = provider.install(workspaceSnapshot(1, [first, second]));
		const initialDocument = JSON.parse(
			decoder.decode(await provider.readFile(initial.configPath)),
		) as { folders: unknown[] };

		expect(initialDocument.folders).toEqual([
			{ uri: first.uri, name: first.displayName },
			{ uri: second.uri, name: second.displayName },
		]);

		const updated = provider.install(workspaceSnapshot(2, [second, first]));
		const updatedDocument = JSON.parse(
			decoder.decode(await provider.readFile(initial.configPath)),
		) as { folders: unknown[] };
		expect(updated.configPath.toString()).toBe(initial.configPath.toString());
		expect(updatedDocument.folders).toEqual([
			{ uri: second.uri, name: second.displayName },
			{ uri: first.uri, name: first.displayName },
		]);
	});

	it("generates a bounded readable configuration for exactly 256 roots", async () => {
		const provider = createPlainWorkspaceConfigurationProvider();
		const roots = Array.from({ length: 256 }, (_, index) =>
			workspaceRoot(index, `root-${index}-${"x".repeat(240)}`),
		);
		const installation = provider.install(workspaceSnapshot(1, roots));
		const bytes = await provider.readFile(installation.configPath);
		const document = JSON.parse(decoder.decode(bytes)) as {
			folders: { uri: string; name: string }[];
		};

		expect(bytes.byteLength).toBeLessThanOrEqual(512 * 1_024);
		expect(document.folders).toHaveLength(256);
		expect(document.folders[0]).toEqual({
			uri: roots[0]!.uri,
			name: roots[0]!.displayName,
		});
		expect(document.folders[255]).toEqual({
			uri: roots[255]!.uri,
			name: roots[255]!.displayName,
		});
	});

	it("copies the installed snapshot and rejects zero, overflow, accessor and Proxy inputs", async () => {
		const provider = createPlainWorkspaceConfigurationProvider();
		const mutableRoot = workspaceRoot(1, "before");
		const mutableSnapshot = workspaceSnapshot(1, [mutableRoot]);
		const installation = provider.install(mutableSnapshot);
		(mutableRoot as { displayName: string }).displayName = "after";
		(mutableSnapshot as { revision: number }).revision = 99;

		const installedDocument = JSON.parse(
			decoder.decode(await provider.readFile(installation.configPath)),
		) as { folders: { name: string }[] };
		expect(installedDocument.folders[0]!.name).toBe("before");
		expect(installation.revision).toBe(1);

		let accessorReads = 0;
		const accessorRoot = workspaceRoot(2);
		Object.defineProperty(accessorRoot, "displayName", {
			enumerable: true,
			get() {
				accessorReads += 1;
				return "private-name";
			},
		});
		let proxyReads = 0;
		const proxySnapshot = new Proxy(workspaceSnapshot(2, [workspaceRoot(3)]), {
			get(target, property, receiver) {
				proxyReads += 1;
				return Reflect.get(target, property, receiver);
			},
		});

		for (const candidate of [
			workspaceSnapshot(2, []),
			workspaceSnapshot(
				2,
				Array.from({ length: 257 }, (_, index) => workspaceRoot(index)),
			),
			workspaceSnapshot(2, [accessorRoot]),
			proxySnapshot,
			{ ...workspaceSnapshot(2, [workspaceRoot(4)]), extra: true },
		]) {
			expect(() =>
				provider.install(candidate as WorkspaceSnapshot),
			).toThrowError(
				expect.objectContaining({ code: "IPC_CONTRACT_VIOLATION" }),
			);
		}
		expect(accessorReads).toBe(0);
		expect(proxyReads).toBe(0);
	});

	it("accepts no-op watches only for the exact file or scheme root", () => {
		const provider = createPlainWorkspaceConfigurationProvider();
		const installation = provider.install(
			workspaceSnapshot(1, [workspaceRoot(1)]),
		);
		const options = { recursive: false, excludes: [] };
		const fileWatch = provider.watch(installation.configPath, options);
		const rootWatch = provider.watch(
			URI.from({ scheme: PLAIN_WORKSPACE_CONFIGURATION_SCHEME, path: "/" }),
			options,
		);

		expect(() => fileWatch.dispose()).not.toThrow();
		expect(() => fileWatch.dispose()).not.toThrow();
		expect(() => rootWatch.dispose()).not.toThrow();
		for (const resource of [
			URI.from({
				scheme: PLAIN_WORKSPACE_CONFIGURATION_SCHEME,
				authority: workspaceId,
				path: "/",
			}),
			installation.configPath.with({ query: "revision=1" }),
			configurationUri(otherWorkspaceId),
		]) {
			expect(() => provider.watch(resource, options)).toThrowError(
				expect.objectContaining({
					code: FileSystemProviderErrorCode.NoPermissions,
				}),
			);
		}
	});

	it("rejects wrong scheme, authority, path, query and fragment without disclosure", async () => {
		const provider = createPlainWorkspaceConfigurationProvider();
		const installation = provider.install(
			workspaceSnapshot(1, [workspaceRoot(1)]),
		);
		let accessorReads = 0;
		const accessorResource = {
			scheme: PLAIN_WORKSPACE_CONFIGURATION_SCHEME,
			authority: workspaceId,
			query: "",
			fragment: "",
		};
		Object.defineProperty(accessorResource, "path", {
			enumerable: true,
			get() {
				accessorReads += 1;
				return PLAIN_WORKSPACE_CONFIGURATION_PATH;
			},
		});
		let proxyReads = 0;
		const proxyResource = new Proxy(configurationUri(), {
			get(target, property, receiver) {
				proxyReads += 1;
				return Reflect.get(target, property, receiver);
			},
		});
		const invalidResources = [
			URI.from({
				scheme: "file",
				authority: workspaceId,
				path: PLAIN_WORKSPACE_CONFIGURATION_PATH,
			}),
			configurationUri(otherWorkspaceId),
			installation.configPath.with({ path: "/private-secret" }),
			installation.configPath.with({ query: "private-secret" }),
			installation.configPath.with({ fragment: "private-secret" }),
			accessorResource as unknown as URI,
			proxyResource,
		];

		for (const resource of invalidResources) {
			for (const operation of [
				() => provider.stat(resource),
				() => provider.readFile(resource),
			]) {
				const error = await expectProviderError(
					operation,
					FileSystemProviderErrorCode.NoPermissions,
				);
				expect(error.message).not.toContain("private-secret");
				expect(error.message).not.toContain(workspaceId);
			}
		}
		expect(accessorReads).toBe(0);
		expect(proxyReads).toBe(0);
	});

	it("rejects every write and directory surface with one sanitized NoPermissions error", async () => {
		const provider = createPlainWorkspaceConfigurationProvider();
		const installation = provider.install(
			workspaceSnapshot(1, [workspaceRoot(1)]),
		);
		const target = installation.configPath.with({ path: "/private-target" });
		const operations = [
			() =>
				provider.writeFile(installation.configPath, new Uint8Array([1]), {
					create: false,
					overwrite: true,
					unlock: false,
					atomic: false,
				}),
			() => provider.mkdir(target),
			() => provider.readdir(installation.configPath),
			() =>
				provider.delete(installation.configPath, {
					recursive: false,
					useTrash: false,
					atomic: false,
				}),
			() =>
				provider.rename(installation.configPath, target, { overwrite: false }),
			() =>
				provider.copy(installation.configPath, target, { overwrite: false }),
		];

		for (const operation of operations) {
			const error = await expectProviderError(
				operation,
				FileSystemProviderErrorCode.NoPermissions,
			);
			expect(error.message).toBe(
				"The generated workspace configuration cannot be accessed.",
			);
			expect(error.message).not.toContain("private-target");
		}
		expect(
			JSON.parse(
				decoder.decode(await provider.readFile(installation.configPath)),
			),
		).toMatchObject({ folders: [{ name: "root-1" }] });
	});

	it("clears installed content without events and makes the old exact URI not found", async () => {
		const provider = createPlainWorkspaceConfigurationProvider();
		const changes = vi.fn();
		provider.onDidChangeFile(changes);
		const installation = provider.install(
			workspaceSnapshot(1, [workspaceRoot(1, "private-root-name")]),
		);
		expect(await provider.readFile(installation.configPath)).not.toHaveLength(
			0,
		);

		provider.clear();
		provider.clear();
		for (const operation of [
			() => provider.stat(installation.configPath),
			() => provider.readFile(installation.configPath),
		]) {
			const error = await expectProviderError(
				operation,
				FileSystemProviderErrorCode.FileNotFound,
			);
			expect(error.message).not.toContain("private-root-name");
		}
		await expectProviderError(
			() => provider.readFile(configurationUri(otherWorkspaceId)),
			FileSystemProviderErrorCode.NoPermissions,
		);
		expect(changes).not.toHaveBeenCalled();

		const reinstalled = provider.install(
			workspaceSnapshot(2, [workspaceRoot(2, "replacement")]),
		);
		expect(reinstalled.configPath.toString()).toBe(
			installation.configPath.toString(),
		);
		expect(
			JSON.parse(
				decoder.decode(await provider.readFile(reinstalled.configPath)),
			),
		).toMatchObject({ folders: [{ name: "replacement" }] });
		expect(changes).not.toHaveBeenCalled();
	});
});
