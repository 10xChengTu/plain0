import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import {
	FileChangeType,
	FileOperationError,
	FileOperationResult,
	FileSystemProviderError,
	FileSystemProviderErrorCode,
	FileType,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files";
import { describe, expect, it, vi } from "vitest";

import {
	PlainUserDataFileSystemProvider,
	userDataUri,
} from "../../app/features/preferences/user-data-file-system-provider";
import type {
	PlainBridge,
	UserDataChangedEvent,
	UserDataResource,
	UserDataResult,
} from "../../app/platform/tauri";

function fixture() {
	const entries = new Map<UserDataResource, UserDataResult>([
		["settings", { resource: "settings", revision: 1, content: "{}\n" }],
		["keybindings", { resource: "keybindings", revision: 1, content: "[]\n" }],
	]);
	let listener: ((event: UserDataChangedEvent) => void) | undefined;
	const read = vi.fn(async (resource: UserDataResource) =>
		entries.get(resource)!,
	);
	const write = vi.fn(
		async (
			resource: UserDataResource,
			expectedRevision: number,
			content: string,
		): Promise<UserDataResult> => {
			const current = entries.get(resource)!;
			if (current.revision !== expectedRevision) {
				throw {
					code: "USER_DATA_CONFLICT",
					message: "conflict",
				};
			}
			const next = Object.freeze({
				resource,
				revision: expectedRevision + 1,
				content,
			});
			entries.set(resource, next);
			return next;
		},
	);
	const bridge = {
		userDataRead: read,
		userDataWrite: write,
		onUserDataChanged: vi.fn(async (next) => {
			listener = next;
			return () => {
				listener = undefined;
			};
		}),
	} as unknown as PlainBridge;
	return {
		bridge,
		entries,
		read,
		write,
		emit(event: UserDataChangedEvent) {
			listener?.(event);
		},
	};
}

describe("PlainUserDataFileSystemProvider", () => {
	it("exposes exactly the User directory and two files", async () => {
		const { bridge } = fixture();
		const provider = new PlainUserDataFileSystemProvider(bridge);
		expect(
			await provider.readdir(
				URI.from({ scheme: "vscode-userdata", path: "/" }),
			),
		).toEqual([["User", FileType.Directory]]);
		expect(
			await provider.readdir(
				URI.from({ scheme: "vscode-userdata", path: "/User" }),
			),
		).toEqual([
			["settings.json", FileType.File],
			["keybindings.json", FileType.File],
		]);

		await expect(
			provider.readFile(
				URI.from({
					scheme: "vscode-userdata",
					path: "/User/tasks.json",
				}),
			),
		).rejects.toMatchObject({
			code: FileSystemProviderErrorCode.FileNotFound,
		});

		for (const resource of [
			URI.from({ scheme: "file", path: "/User/settings.json" }),
			URI.from({
				scheme: "vscode-userdata",
				path: "/User/settings.json",
				query: "native=/tmp/settings.json",
			}),
		]) {
			await expect(provider.readFile(resource)).rejects.toMatchObject({
				code: FileSystemProviderErrorCode.NoPermissions,
			});
		}
	});

	it("reads, versions and writes through the Rust bridge", async () => {
		const { bridge, read, write } = fixture();
		const provider = new PlainUserDataFileSystemProvider(bridge);
		const resource = userDataUri("settings");
		expect(new TextDecoder().decode(await provider.readFile(resource))).toBe(
			"{}\n",
		);
		expect((await provider.stat(resource)).mtime).toBe(1);

		await provider.writeFile(
			resource,
			new TextEncoder().encode(
				'{"files.autoSave":"afterDelay","files.autoSaveDelay":50}\n',
			),
			{ create: true, overwrite: true, unlock: false, atomic: false },
		);
		expect(read).toHaveBeenCalledTimes(1);
		expect(write).toHaveBeenCalledWith(
			"settings",
			1,
			'{"files.autoSave":"afterDelay","files.autoSaveDelay":50}\n',
		);
		expect((await provider.stat(resource)).mtime).toBe(2);
	});

	it("invalidates a stale cache on a newer sibling-window event", async () => {
		const { bridge, entries, read, emit } = fixture();
		const provider = new PlainUserDataFileSystemProvider(bridge);
		const changes: number[] = [];
		provider.onDidChangeFile((events) => changes.push(events[0]!.type));
		await provider.readFile(userDataUri("keybindings"));
		entries.set("keybindings", {
			resource: "keybindings",
			revision: 2,
			content: '[{"key":"cmd+k","command":"plain.test"}]\n',
		});
		emit({ resource: "keybindings", revision: 2 });
		expect(
			new TextDecoder().decode(
				await provider.readFile(userDataUri("keybindings")),
			),
		).toContain("plain.test");
		expect(read).toHaveBeenCalledTimes(2);
		expect(changes).toContain(FileChangeType.UPDATED);
	});

	it("maps revision conflicts without silently retrying", async () => {
		const { bridge, entries, write } = fixture();
		const provider = new PlainUserDataFileSystemProvider(bridge);
		const resource = userDataUri("settings");
		await provider.readFile(resource);
		entries.set("settings", {
			resource: "settings",
			revision: 2,
			content: "{}\n",
		});
		let observed: unknown;
		try {
			await provider.writeFile(resource, new TextEncoder().encode("{}\n"), {
				create: true,
				overwrite: true,
				unlock: false,
				atomic: false,
			});
		} catch (error) {
			observed = error;
		}
		expect(observed).toBeInstanceOf(FileOperationError);
		expect((observed as FileOperationError).fileOperationResult).toBe(
			FileOperationResult.FILE_MODIFIED_SINCE,
		);
		expect(write).toHaveBeenCalledTimes(1);
	});

	it("does not permit delete, rename or arbitrary mkdir", async () => {
		const { bridge } = fixture();
		const provider = new PlainUserDataFileSystemProvider(bridge);
		await expect(
			provider.delete(userDataUri("settings"), {
				recursive: false,
				useTrash: false,
				atomic: false,
			}),
		).rejects.toBeInstanceOf(FileSystemProviderError);
		await expect(
			provider.rename(userDataUri("settings"), userDataUri("keybindings"), {
				overwrite: false,
			}),
		).rejects.toMatchObject({
			code: FileSystemProviderErrorCode.NoPermissions,
		});
		await expect(
			provider.mkdir(
				URI.from({ scheme: "vscode-userdata", path: "/User/snippets" }),
			),
		).rejects.toMatchObject({
			code: FileSystemProviderErrorCode.NoPermissions,
		});
	});
});
