import { beforeEach, describe, expect, it, vi } from "vitest";

import workspaceVersionFixture from "../fixtures/workspace-version-v1.json" with { type: "json" };

const tauri = vi.hoisted(() => ({
	invoke: vi.fn(),
	listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauri.listen }));

import { createNativeBridge } from "../../app/platform/tauri/native";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const rootId = "00000000-0000-4000-8000-000000000101";
const targetRootId = "00000000-0000-4000-8000-000000000102";
const version = `wv1:${"a".repeat(64)}`;

function arrayBufferFromHex(hex: string): ArrayBuffer {
	const bytes = new Uint8Array(hex.length / 2);
	for (let index = 0; index < bytes.length; index += 1) {
		bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
	}
	return bytes.buffer;
}

function validRoot() {
	return {
		rootId,
		displayName: "workspace",
		uri: `plain-workspace://${rootId}/`,
	};
}

function validSnapshot() {
	return {
		workspaceId,
		revision: 1,
		roots: [validRoot()],
	};
}

function validWrittenResult() {
	return {
		status: "written",
		stat: {
			kind: "file",
			size: 4,
			mtime: 1_700_000_000_124,
			ctime: 1_699_999_999_000,
			version: `wv1:${"b".repeat(64)}`,
		},
	};
}

describe("native Plain bridge", () => {
	beforeEach(() => {
		tauri.invoke.mockReset();
		tauri.listen.mockReset();
	});

	it("shares the watcher manager while strictly decoding wake events and acknowledging generations", async () => {
		vi.useFakeTimers();
		try {
			let wakeHandler:
				((event: { readonly payload: unknown }) => void) | undefined;
			const unlisten = vi.fn();
			tauri.listen.mockImplementation(
				async (
					eventName: string,
					handler: (event: { readonly payload: unknown }) => void,
				) => {
					expect(eventName).toBe("plain://workspace-watch-wake");
					wakeHandler = handler;
					return unlisten;
				},
			);
			let syncCount = 0;
			tauri.invoke.mockImplementation(async (command: string) => {
				expect(command).toBe("workspace_watch_sync");
				syncCount += 1;
				return {
					workspaceId,
					roots:
						syncCount === 1
							? [{ rootId, generation: 1, rescanRequired: true }]
							: syncCount === 3
								? [{ rootId, generation: 2, rescanRequired: false }]
								: [],
				};
			});
			const listener = vi.fn();
			const bridge = createNativeBridge();
			bridge.workspaceReconcileWatchRoots([rootId]);

			const stop = bridge.workspaceWatch(rootId, listener);
			for (let index = 0; index < 8; index += 1) {
				await vi.advanceTimersByTimeAsync(1);
				await Promise.resolve();
			}

			expect(tauri.listen).toHaveBeenCalledOnce();
			expect(listener).toHaveBeenCalledOnce();
			expect(tauri.invoke.mock.calls).toEqual([
				[
					"workspace_watch_sync",
					{
						request: {
							roots: [{ rootId, acknowledgedGeneration: null }],
						},
					},
				],
				[
					"workspace_watch_sync",
					{
						request: {
							roots: [{ rootId, acknowledgedGeneration: 1 }],
						},
					},
				],
			]);
			expect(() =>
				wakeHandler?.({
					payload: { workspaceId, nativePath: "/private/workspace" },
				}),
			).toThrowError(
				expect.objectContaining({ code: "IPC_CONTRACT_VIOLATION" }),
			);

			wakeHandler?.({ payload: { workspaceId } });
			for (let index = 0; index < 8; index += 1) {
				await vi.advanceTimersByTimeAsync(1);
				await Promise.resolve();
			}
			expect(listener).toHaveBeenCalledTimes(2);
			expect(tauri.invoke.mock.calls.at(-2)?.[1]).toEqual({
				request: {
					roots: [{ rootId, acknowledgedGeneration: 1 }],
				},
			});
			expect(tauri.invoke.mock.calls.at(-1)?.[1]).toEqual({
				request: {
					roots: [{ rootId, acknowledgedGeneration: 2 }],
				},
			});

			bridge.workspaceReconcileWatchRoots([]);
			await Promise.resolve();
			await Promise.resolve();
			expect(unlisten).toHaveBeenCalledOnce();
			stop();
		} finally {
			vi.useRealTimers();
		}
	});

	it("invokes and strictly freezes the workspace capability contract", async () => {
		tauri.invoke.mockResolvedValueOnce({
			create: true,
			renameNoReplace: true,
			copyMove: true,
			delete: true,
			versionedWrite: true,
		});
		const bridge = createNativeBridge();

		const capabilities = await bridge.workspaceCapabilities();

		expect(tauri.invoke).toHaveBeenCalledOnce();
		expect(tauri.invoke).toHaveBeenCalledWith("workspace_capabilities", {
			request: {},
		});
		expect(capabilities).toEqual({
			create: true,
			renameNoReplace: true,
			copyMove: true,
			delete: true,
			versionedWrite: true,
		});
		expect(Object.isFrozen(capabilities)).toBe(true);
	});

	it("routes local user data through exact DTOs and strictly decodes sibling-window invalidations", async () => {
		let changedHandler:
			((event: { readonly payload: unknown }) => void) | undefined;
		const unlisten = vi.fn();
		tauri.listen.mockImplementation(
			async (
				eventName: string,
				handler: (event: { readonly payload: unknown }) => void,
			) => {
				expect(eventName).toBe("plain://user-data-changed");
				changedHandler = handler;
				return unlisten;
			},
		);
		tauri.invoke
			.mockResolvedValueOnce({
				resource: "settings",
				revision: 2,
				content: "{}\n",
			})
			.mockResolvedValueOnce({
				resource: "settings",
				revision: 3,
				content: '{ "files.autoSave": "afterDelay" }\n',
			});
		const bridge = createNativeBridge();

		const read = await bridge.userDataRead("settings");
		const written = await bridge.userDataWrite(
			"settings",
			2,
			'{ "files.autoSave": "afterDelay" }\n',
		);
		const listener = vi.fn();
		const stop = await bridge.onUserDataChanged(listener);

		expect(tauri.invoke.mock.calls).toEqual([
			["user_data_read", { request: { resource: "settings" } }],
			[
				"user_data_write",
				{
					request: {
						resource: "settings",
						expectedRevision: 2,
						content: '{ "files.autoSave": "afterDelay" }\n',
					},
				},
			],
		]);
		expect(Object.isFrozen(read)).toBe(true);
		expect(Object.isFrozen(written)).toBe(true);

		changedHandler?.({ payload: { resource: "settings", revision: 3 } });
		expect(listener).toHaveBeenCalledOnce();
		const [event] = listener.mock.calls[0] as [unknown];
		expect(event).toEqual({ resource: "settings", revision: 3 });
		expect(Object.isFrozen(event)).toBe(true);
		expect(() =>
			changedHandler?.({
				payload: { resource: "settings", revision: 4, nativePath: "/tmp" },
			}),
		).toThrowError(expect.objectContaining({ code: "IPC_CONTRACT_VIOLATION" }));
		await stop();
		expect(unlisten).toHaveBeenCalledOnce();
	});

	it("uses owned request DTOs and decodes immutable workspace results", async () => {
		tauri.invoke
			.mockResolvedValueOnce(validSnapshot())
			.mockResolvedValueOnce({
				status: "selected",
				snapshot: validSnapshot(),
			})
			.mockResolvedValueOnce({
				...validSnapshot(),
				revision: 2,
				roots: [],
			});
		const bridge = createNativeBridge();

		const snapshot = await bridge.workspaceSnapshot();
		const picked = await bridge.workspacePickRoots("replace");
		const removed = await bridge.workspaceRemoveRoot(rootId);

		expect(tauri.invoke.mock.calls).toEqual([
			["workspace_snapshot", { request: {} }],
			["workspace_pick_roots", { request: { mode: "replace" } }],
			["workspace_remove_root", { request: { rootId } }],
		]);
		expect(snapshot).toEqual(validSnapshot());
		expect(picked.status).toBe("selected");
		expect(removed.revision).toBe(2);
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.roots)).toBe(true);
		expect(Object.isFrozen(snapshot.roots[0])).toBe(true);
	});

	it("keeps Open File and Recent IPC path-free with frozen exact requests", async () => {
		const recentId = "00000000-0000-4000-8000-000000000201";
		tauri.invoke
			.mockResolvedValueOnce({
				status: "selected",
				snapshot: validSnapshot(),
				files: [{ rootId, relativePath: "README.md" }],
			})
			.mockResolvedValueOnce({
				revision: 2,
				restoreStatus: "restored",
				entries: [{ recentId, label: "workspace", rootLabels: ["workspace"] }],
			})
			.mockResolvedValueOnce(validSnapshot())
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null);
		const bridge = createNativeBridge();

		const opened = await bridge.workspaceOpenFiles();
		const recent = await bridge.workspaceRecentList();
		await bridge.workspaceOpenRecent(recentId);
		await bridge.workspaceRemoveRecent(recentId);
		await bridge.workspaceClearRecent();

		expect(tauri.invoke.mock.calls).toEqual([
			["workspace_open_files", { request: {} }],
			["workspace_recent_list", { request: {} }],
			["workspace_open_recent", { request: { recentId } }],
			["workspace_remove_recent", { request: { recentId } }],
			["workspace_clear_recent", { request: {} }],
		]);
		expect(opened.files).toEqual([{ rootId, relativePath: "README.md" }]);
		expect(recent.entries[0]?.rootLabels).toEqual(["workspace"]);
		expect(Object.isFrozen(opened.files)).toBe(true);
		expect(Object.isFrozen(recent.entries)).toBe(true);
		for (const [, arguments_] of tauri.invoke.mock.calls) {
			expect(Object.isFrozen(arguments_?.request)).toBe(true);
			expect(JSON.stringify(arguments_)).not.toContain("/Users/");
		}
	});

	it("binds Save As selection to an authorized target and dispatches one exact PLN1 frame", async () => {
		const contentBacking = new Uint8Array([9, 0, 0x41, 0xff, 0x0a, 9]);
		const content = contentBacking.subarray(1, 5);
		let dispatchedFrame: Uint8Array | undefined;
		tauri.invoke
			.mockResolvedValueOnce({
				status: "selected",
				snapshot: validSnapshot(),
				target: {
					rootId,
					relativePath: "draft.txt",
					existingStat: null,
				},
			})
			.mockImplementationOnce((command, raw) => {
				expect(command).toBe("workspace_publish_file");
				dispatchedFrame = raw as Uint8Array;
				contentBacking.fill(7);
				return Promise.resolve(validWrittenResult());
			});
		const bridge = createNativeBridge();

		const picked = await bridge.workspacePickSaveTarget("draft.txt");
		const published = await bridge.workspacePublishFile(
			rootId,
			"draft.txt",
			content,
		);

		expect(tauri.invoke.mock.calls[0]).toEqual([
			"workspace_pick_save_target",
			{ request: { suggestedName: "draft.txt" } },
		]);
		expect(Object.isFrozen(tauri.invoke.mock.calls[0]?.[1]?.request)).toBe(
			true,
		);
		expect(picked.target).toEqual({
			rootId,
			relativePath: "draft.txt",
			existingStat: null,
		});
		expect(Object.isFrozen(picked.target)).toBe(true);
		expect(dispatchedFrame?.slice(0, 4)).toEqual(
			Uint8Array.from([0x50, 0x4c, 0x4e, 0x31]),
		);
		const frameView = new DataView(
			dispatchedFrame!.buffer,
			dispatchedFrame!.byteOffset,
			dispatchedFrame!.byteLength,
		);
		expect(frameView.getUint16(4, false)).toBe(36);
		expect(frameView.getUint16(6, false)).toBe(9);
		expect(frameView.getUint32(8, false)).toBe(4);
		expect(dispatchedFrame?.slice(-4)).toEqual(
			Uint8Array.from([0, 0x41, 0xff, 0x0a]),
		);
		expect(dispatchedFrame?.byteOffset).toBe(0);
		expect(published).toEqual(validWrittenResult());
	});

	it("rejects malformed Save As requests locally and preserves safe publication collisions", async () => {
		const bridge = createNativeBridge();
		for (const name of ["", "nested/file.txt", "..", "a".repeat(256)]) {
			await expect(bridge.workspacePickSaveTarget(name)).rejects.toMatchObject({
				code: "WORKSPACE_SAVE_TARGET_REQUEST_INVALID",
			});
		}
		expect(tauri.invoke).not.toHaveBeenCalled();

		const collision = {
			code: "ENTRY_ALREADY_EXISTS",
			message: "The workspace entry already exists.",
		};
		tauri.invoke.mockRejectedValueOnce(collision);
		await expect(
			bridge.workspacePublishFile(rootId, "draft.txt", new Uint8Array()),
		).rejects.toEqual(collision);

		const publishedButChanged = {
			status: "targetPublished",
			publicationEvidence: "renameReportedSuccess",
			rename: "reportedSuccess",
			directorySync: "synced",
			target: "changed",
		};
		tauri.invoke.mockResolvedValueOnce(publishedButChanged);
		await expect(
			bridge.workspacePublishFile(rootId, "draft.txt", new Uint8Array()),
		).resolves.toEqual(publishedButChanged);

		tauri.invoke.mockResolvedValueOnce({
			status: "targetPublished",
			publicationEvidence: "targetObservedWritten",
			rename: "reportedFailure",
			directorySync: "failed",
			target: "changed",
		});
		await expect(
			bridge.workspacePublishFile(rootId, "draft.txt", new Uint8Array()),
		).resolves.toEqual({
			status: "outcomeUnknown",
			observation: "responseUnavailable",
			rename: "unobserved",
			directorySync: "unobserved",
			target: "ambiguous",
		});
	});

	it("rejects invalid recent ids before native invocation", async () => {
		const bridge = createNativeBridge();
		for (const recentId of ["not-an-id", "/Users/private"]) {
			await expect(bridge.workspaceOpenRecent(recentId)).rejects.toMatchObject({
				code: "WORKSPACE_RECENT_REQUEST_INVALID",
			});
			await expect(
				bridge.workspaceRemoveRecent(recentId),
			).rejects.toMatchObject({
				code: "WORKSPACE_RECENT_REQUEST_INVALID",
			});
		}
		expect(tauri.invoke).not.toHaveBeenCalled();
	});

	it("keeps decoded topology responses side-effect free until accepted roots are reconciled", async () => {
		vi.useFakeTimers();
		try {
			const unlisten = vi.fn();
			tauri.listen.mockResolvedValue(unlisten);
			tauri.invoke.mockResolvedValueOnce(validSnapshot());
			const bridge = createNativeBridge();
			bridge.workspaceReconcileWatchRoots([targetRootId]);
			const stop = bridge.workspaceWatch(targetRootId, vi.fn());
			await Promise.resolve();
			await Promise.resolve();

			await expect(bridge.workspaceSnapshot()).resolves.toEqual(
				validSnapshot(),
			);
			await Promise.resolve();
			expect(unlisten).not.toHaveBeenCalled();
			expect(tauri.invoke).toHaveBeenCalledExactlyOnceWith(
				"workspace_snapshot",
				{ request: {} },
			);

			bridge.workspaceReconcileWatchRoots([]);
			await Promise.resolve();
			await Promise.resolve();
			expect(unlisten).toHaveBeenCalledOnce();
			stop();
		} finally {
			vi.useRealTimers();
		}
	});

	it("invokes the bounded file commands with frozen owned requests", async () => {
		const rawReadFrame = arrayBufferFromHex(
			workspaceVersionFixture.read.frameHex,
		);
		tauri.invoke
			.mockResolvedValueOnce({
				kind: "file",
				size: 0,
				mtime: 0,
				ctime: 0,
				version: null,
			})
			.mockResolvedValueOnce({
				kind: "directory",
				size: 0,
				mtime: 0,
				ctime: 0,
				version: null,
			})
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({
				kind: "file",
				size: 4,
				mtime: 1_700_000_000_000,
				ctime: 0,
				version: null,
			})
			.mockResolvedValueOnce({
				entries: [
					{ name: "%2F", kind: "file" },
					{ name: "%2e%2e", kind: "directory" },
				],
			})
			.mockResolvedValueOnce(rawReadFrame);
		const bridge = createNativeBridge();

		const createdFile = await bridge.workspaceCreateFile(
			rootId,
			"%2e%2e/new.txt",
		);
		const createdDirectory = await bridge.workspaceCreateDirectory(
			rootId,
			"%2e%2e/new-directory",
		);
		await bridge.workspaceRename(
			rootId,
			"%2e%2e/source.txt",
			"%2e%2e/target.txt",
		);
		await bridge.workspaceCopy(
			rootId,
			"%2e%2e/source.txt",
			targetRootId,
			"%2F/target.txt",
		);
		const stat = await bridge.workspaceStat(rootId, "%2e%2e/file.bin");
		const directory = await bridge.workspaceReadDirectory(rootId, "%2e%2e");
		const file = await bridge.workspaceReadFile(rootId, "%2F");

		expect(tauri.invoke.mock.calls).toEqual([
			[
				"workspace_create_file",
				{ request: { rootId, relativePath: "%2e%2e/new.txt" } },
			],
			[
				"workspace_create_directory",
				{ request: { rootId, relativePath: "%2e%2e/new-directory" } },
			],
			[
				"workspace_rename",
				{
					request: {
						rootId,
						sourcePath: "%2e%2e/source.txt",
						targetPath: "%2e%2e/target.txt",
					},
				},
			],
			[
				"workspace_copy",
				{
					request: {
						sourceRootId: rootId,
						sourcePath: "%2e%2e/source.txt",
						targetRootId,
						targetPath: "%2F/target.txt",
					},
				},
			],
			[
				"workspace_stat",
				{ request: { rootId, relativePath: "%2e%2e/file.bin" } },
			],
			["workspace_read_dir", { request: { rootId, relativePath: "%2e%2e" } }],
			["workspace_read_file", { request: { rootId, relativePath: "%2F" } }],
		]);
		for (const [, arguments_] of tauri.invoke.mock.calls) {
			expect(Object.isFrozen(arguments_?.request)).toBe(true);
		}
		expect(createdFile).toEqual({
			kind: "file",
			size: 0,
			mtime: 0,
			ctime: 0,
			version: null,
		});
		expect(createdDirectory).toEqual({
			kind: "directory",
			size: 0,
			mtime: 0,
			ctime: 0,
			version: null,
		});
		expect(Object.isFrozen(createdFile)).toBe(true);
		expect(Object.isFrozen(createdDirectory)).toBe(true);
		expect(stat).toEqual({
			kind: "file",
			size: 4,
			mtime: 1_700_000_000_000,
			ctime: 0,
			version: null,
		});
		expect(Object.isFrozen(stat)).toBe(true);
		expect(directory.entries.map(({ name }) => name)).toEqual([
			"%2F",
			"%2e%2e",
		]);
		expect(Object.isFrozen(directory.entries)).toBe(true);
		new Uint8Array(rawReadFrame).fill(99);
		expect(file.stat).toEqual({
			kind: workspaceVersionFixture.read.kind,
			size: workspaceVersionFixture.read.size,
			mtime: workspaceVersionFixture.read.mtimeMs,
			ctime: workspaceVersionFixture.read.ctimeMs,
			version: workspaceVersionFixture.read.version,
		});
		expect(Buffer.from(file.value.copy()).toString("hex")).toBe(
			workspaceVersionFixture.read.contentHex,
		);
		expect(Object.isFrozen(file)).toBe(true);
		expect(Object.isFrozen(file.stat)).toBe(true);
		expect(Object.isFrozen(file.value)).toBe(true);
	});

	it("requires stat receipts for create and null for void mutation commands", async () => {
		tauri.invoke
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce("ok");
		const bridge = createNativeBridge();

		await expect(
			bridge.workspaceCreateFile(rootId, "new.txt"),
		).rejects.toMatchObject({ code: "IPC_CONTRACT_VIOLATION" });
		await expect(
			bridge.workspaceCreateDirectory(rootId, "new-directory"),
		).rejects.toMatchObject({ code: "IPC_CONTRACT_VIOLATION" });
		await expect(
			bridge.workspaceRename(rootId, "source", "target"),
		).rejects.toMatchObject({ code: "IPC_CONTRACT_VIOLATION" });
		await expect(
			bridge.workspaceCopy(rootId, "source", targetRootId, "target"),
		).rejects.toMatchObject({ code: "IPC_CONTRACT_VIOLATION" });
	});

	it.each([
		[{ status: "moved" }],
		[
			{
				status: "targetPublishedSourceRetained",
				reason: "sourceChanged",
			},
		],
		[
			{
				status: "targetPublishedSourcePartiallyDeleted",
				reason: "targetUnverifiable",
				removedEntries: 1,
			},
		],
		[
			{
				status: "targetPublishedSourcePartiallyDeleted",
				reason: "deleteFailed",
				removedEntries: 10_000,
			},
		],
	] as const)(
		"invokes workspace_move and freezes its strict result: %j",
		async (payload) => {
			tauri.invoke.mockResolvedValueOnce(payload);
			const result = await createNativeBridge().workspaceMove(
				rootId,
				"source",
				targetRootId,
				"target",
			);

			expect(tauri.invoke).toHaveBeenCalledWith("workspace_move", {
				request: {
					sourceRootId: rootId,
					sourcePath: "source",
					targetRootId,
					targetPath: "target",
				},
			});
			expect(Object.isFrozen(tauri.invoke.mock.calls[0]?.[1]?.request)).toBe(
				true,
			);
			expect(result).toEqual(payload);
			expect(Object.isFrozen(result)).toBe(true);
		},
	);

	it.each([
		"sourceChanged",
		"targetChanged",
		"sourceUnverifiable",
		"targetUnverifiable",
		"deleteFailed",
	] as const)("accepts the move incomplete reason %s", async (reason) => {
		tauri.invoke.mockResolvedValueOnce({
			status: "targetPublishedSourceRetained",
			reason,
		});

		await expect(
			createNativeBridge().workspaceMove(
				rootId,
				"source",
				targetRootId,
				"target",
			),
		).resolves.toEqual({ status: "targetPublishedSourceRetained", reason });
	});

	it.each([
		["non-object", "moved"],
		[
			"class prototype",
			Object.assign(new (class MoveResult {})(), { status: "moved" }),
		],
		["moved extra key", { status: "moved", reason: "sourceChanged" }],
		["retained missing reason", { status: "targetPublishedSourceRetained" }],
		[
			"retained unknown reason",
			{
				status: "targetPublishedSourceRetained",
				reason: "cancelled",
			},
		],
		[
			"partial zero removals",
			{
				status: "targetPublishedSourcePartiallyDeleted",
				reason: "deleteFailed",
				removedEntries: 0,
			},
		],
		[
			"partial removal overflow",
			{
				status: "targetPublishedSourcePartiallyDeleted",
				reason: "deleteFailed",
				removedEntries: 10_001,
			},
		],
		[
			"partial fractional removals",
			{
				status: "targetPublishedSourcePartiallyDeleted",
				reason: "deleteFailed",
				removedEntries: 1.5,
			},
		],
		[
			"partial extra key",
			{
				status: "targetPublishedSourcePartiallyDeleted",
				reason: "deleteFailed",
				removedEntries: 1,
				nativePath: "/private/source",
			},
		],
		["unknown status", { status: "copied" }],
	] as const)(
		"rejects malformed workspace move results: %s",
		async (_name, payload) => {
			tauri.invoke.mockResolvedValueOnce(payload);

			await expect(
				createNativeBridge().workspaceMove(
					rootId,
					"source",
					targetRootId,
					"target",
				),
			).rejects.toMatchObject({ code: "IPC_CONTRACT_VIOLATION" });
		},
	);

	it("rejects move-result accessors, proxies, and symbol keys from one data snapshot", async () => {
		let accessorReads = 0;
		const accessorPayload = Object.create(null) as Record<string, unknown>;
		Object.defineProperties(accessorPayload, {
			status: {
				enumerable: true,
				value: "targetPublishedSourceRetained",
			},
			reason: {
				enumerable: true,
				get() {
					accessorReads += 1;
					return "sourceChanged";
				},
			},
		});

		let proxyReads = 0;
		let promiseAssimilationReads = 0;
		const proxyPayload = new Proxy(
			{ status: "moved" },
			{
				get(target, property, receiver) {
					if (property === "then") {
						promiseAssimilationReads += 1;
						return undefined;
					}
					proxyReads += 1;
					return Reflect.get(target, property, receiver);
				},
			},
		);
		const symbolPayload = { status: "moved", [Symbol("private")]: true };
		let nestedAccessorReads = 0;
		const nestedStatus = Object.defineProperty({}, "private", {
			enumerable: true,
			get() {
				nestedAccessorReads += 1;
				return "secret";
			},
		});
		tauri.invoke
			.mockResolvedValueOnce(accessorPayload)
			.mockResolvedValueOnce(proxyPayload)
			.mockResolvedValueOnce(symbolPayload)
			.mockResolvedValueOnce({ status: nestedStatus });
		const bridge = createNativeBridge();

		for (let index = 0; index < 4; index += 1) {
			await expect(
				bridge.workspaceMove(
					rootId,
					`source-${index}`,
					targetRootId,
					`target-${index}`,
				),
			).rejects.toMatchObject({ code: "IPC_CONTRACT_VIOLATION" });
		}
		expect(accessorReads).toBe(0);
		expect(proxyReads).toBe(0);
		expect(promiseAssimilationReads).toBe(1);
		expect(nestedAccessorReads).toBe(0);
	});

	it("rejects same-root and malformed move requests before native invoke", async () => {
		const bridge = createNativeBridge();

		await expect(
			bridge.workspaceMove(rootId, "source", rootId, "target"),
		).rejects.toEqual({
			code: "WORKSPACE_CONFLICT",
			message: "The workspace move requires distinct workspace roots.",
		});
		await expect(
			bridge.workspaceMove(rootId, "../source", targetRootId, "target"),
		).rejects.toEqual({
			code: "INVALID_RELATIVE_PATH",
			message: "The workspace-relative path is invalid.",
		});
		expect(tauri.invoke).not.toHaveBeenCalled();
	});

	it("accepts the macOS dense raw-byte fallback and rejects invalid requests before invoke", async () => {
		const fallback = [
			...new Uint8Array(
				arrayBufferFromHex(workspaceVersionFixture.read.frameHex),
			),
		];
		tauri.invoke.mockResolvedValueOnce(fallback);
		const bridge = createNativeBridge();
		const receipt = await bridge.workspaceReadFile(rootId, "binary.bin");
		expect(receipt.stat.version).toBe(workspaceVersionFixture.read.version);
		expect(Buffer.from(receipt.value.copy()).toString("hex")).toBe(
			workspaceVersionFixture.read.contentHex,
		);
		expect(fallback).toHaveLength(0);

		tauri.invoke.mockClear();
		await expect(
			bridge.workspaceStat(rootId, "../private-secret"),
		).rejects.toEqual({
			code: "INVALID_RELATIVE_PATH",
			message: "The workspace-relative path is invalid.",
		});
		await expect(
			bridge.workspaceReadFile(
				"00000000-0000-4000-8000-000000000ABC",
				"binary.bin",
			),
		).rejects.toEqual({
			code: "ROOT_NOT_AUTHORIZED",
			message: "The workspace root is not authorized.",
		});
		await expect(bridge.workspaceCreateFile(rootId, "")).rejects.toEqual({
			code: "ENTRY_TYPE_MISMATCH",
			message: "The workspace entry has an incompatible type.",
		});
		await expect(
			bridge.workspaceCreateDirectory(rootId, "../private-secret"),
		).rejects.toEqual({
			code: "INVALID_RELATIVE_PATH",
			message: "The workspace-relative path is invalid.",
		});
		await expect(bridge.workspaceRename(rootId, "", "target")).rejects.toEqual({
			code: "ENTRY_TYPE_MISMATCH",
			message: "The workspace entry has an incompatible type.",
		});
		await expect(
			bridge.workspaceRename(rootId, "source", "../private-secret"),
		).rejects.toEqual({
			code: "INVALID_RELATIVE_PATH",
			message: "The workspace-relative path is invalid.",
		});
		await expect(
			bridge.workspaceRename(rootId, "source", "source"),
		).rejects.toEqual({
			code: "ENTRY_ALREADY_EXISTS",
			message: "The workspace entry already exists.",
		});
		await expect(
			bridge.workspaceRename(rootId, "source", "source/nested"),
		).rejects.toEqual({
			code: "WORKSPACE_CONFLICT",
			message: "The workspace rename conflicts with the source path.",
		});
		await expect(
			bridge.workspaceCopy(
				rootId,
				"source",
				"00000000-0000-4000-8000-000000000ABC",
				"target",
			),
		).rejects.toEqual({
			code: "ROOT_NOT_AUTHORIZED",
			message: "The workspace root is not authorized.",
		});
		await expect(
			bridge.workspaceCopy(rootId, "../private", targetRootId, "target"),
		).rejects.toEqual({
			code: "INVALID_RELATIVE_PATH",
			message: "The workspace-relative path is invalid.",
		});
		expect(tauri.invoke).not.toHaveBeenCalled();
	});

	it("dispatches one exact top-level PLW1 Uint8Array and isolates a nonzero-offset input", async () => {
		const backing = new Uint8Array([9, 9, 0, 0x41, 0xff, 0x0a, 9]);
		const content = backing.subarray(2, 6);
		let dispatchedFrame: Uint8Array | undefined;
		tauri.invoke.mockImplementationOnce((command, raw) => {
			expect(command).toBe("workspace_write_file");
			expect(Object.getPrototypeOf(raw)).toBe(Uint8Array.prototype);
			dispatchedFrame = raw as Uint8Array;
			backing.fill(7);
			return Promise.resolve(validWrittenResult());
		});
		const bridge = createNativeBridge();

		const result = await bridge.workspaceWriteFile(
			workspaceVersionFixture.rootId,
			workspaceVersionFixture.relativePath,
			workspaceVersionFixture.version,
			content,
		);

		expect(Buffer.from(dispatchedFrame ?? []).toString("hex")).toBe(
			workspaceVersionFixture.write.frameHex,
		);
		expect(dispatchedFrame?.byteOffset).toBe(0);
		expect(dispatchedFrame?.byteLength).toBe(
			dispatchedFrame?.buffer.byteLength,
		);
		expect(tauri.invoke.mock.calls[0]).toHaveLength(2);
		expect(result).toEqual(validWrittenResult());
		expect(Object.isFrozen(result)).toBe(true);
		if (result.status === "written") {
			expect(Object.isFrozen(result.stat)).toBe(true);
		}
	});

	it("rejects malformed PLW1 inputs locally without dispatch", async () => {
		const bridge = createNativeBridge();

		for (const operation of [
			() => bridge.workspaceWriteFile(rootId, "", version, new Uint8Array()),
			() =>
				bridge.workspaceWriteFile(
					rootId,
					"../private",
					version,
					new Uint8Array(),
				),
			() =>
				bridge.workspaceWriteFile(
					rootId,
					"file.bin",
					"wv1:UPPER",
					new Uint8Array(),
				),
			() =>
				bridge.workspaceWriteFile(
					rootId,
					"file.bin",
					version,
					new Uint8Array(8 * 1_024 * 1_024 + 1),
				),
		]) {
			await expect(operation()).rejects.toMatchObject({
				code: expect.any(String),
			});
		}
		expect(tauri.invoke).not.toHaveBeenCalled();
	});

	it("preserves strict pre-publication errors and classifies every untrusted response as unavailable", async () => {
		const strictError = {
			code: "WORKSPACE_FILE_MODIFIED",
			message: "The workspace file changed since it was read.",
		};
		const nonRawWriteErrors = [
			"INVALID_RELATIVE_PATH",
			"PATH_OUTSIDE_ROOT",
			"PATH_ENCODING_UNSUPPORTED",
			"ENTRY_NOT_FOUND",
			"ENTRY_TYPE_MISMATCH",
		] as const;
		tauri.invoke.mockRejectedValueOnce(strictError);
		for (const code of nonRawWriteErrors) {
			tauri.invoke.mockRejectedValueOnce({
				code,
				message: "This code is not reachable from the raw-write route.",
			});
		}
		tauri.invoke
			.mockRejectedValueOnce({
				code: "WORKSPACE_WRITE_RESPONSE_UNAVAILABLE",
				message: "The write task ended without a trustworthy response.",
			})
			.mockRejectedValueOnce({ code: "UNKNOWN", message: "backend wrote" })
			.mockRejectedValueOnce(new Error("response channel lost"))
			.mockResolvedValueOnce({ status: "written", stat: { private: true } })
			.mockResolvedValueOnce({
				status: "targetPublished",
				publicationEvidence: "targetObservedWritten",
				rename: "reportedFailure",
				directorySync: "failed",
				target: "changed",
			});
		const bridge = createNativeBridge();
		const write = () =>
			bridge.workspaceWriteFile(
				rootId,
				"file.bin",
				version,
				new Uint8Array([0, 0x41, 0xff, 0x0a]),
			);

		await expect(write()).rejects.toEqual(strictError);
		for (let index = 0; index < nonRawWriteErrors.length + 4; index += 1) {
			const unknown = await write();
			expect(unknown).toEqual({
				status: "outcomeUnknown",
				observation: "responseUnavailable",
				rename: "unobserved",
				directorySync: "unobserved",
				target: "ambiguous",
			});
			expect(Object.isFrozen(unknown)).toBe(true);
		}
		const published = await write();
		expect(published).toEqual({
			status: "targetPublished",
			publicationEvidence: "targetObservedWritten",
			rename: "reportedFailure",
			directorySync: "failed",
			target: "changed",
		});
		expect(Object.isFrozen(published)).toBe(true);
		expect(tauri.invoke).toHaveBeenCalledTimes(nonRawWriteErrors.length + 6);
	});

	it("rejects hostile macOS byte-array fallbacks", async () => {
		const valid = [
			...new Uint8Array(
				arrayBufferFromHex(workspaceVersionFixture.read.frameHex),
			),
		];
		const sparse: number[] = [];
		sparse.length = valid.length;
		const accessor = [...valid];
		let accessorReads = 0;
		Object.defineProperty(accessor, "0", {
			get() {
				accessorReads += 1;
				return 0x50;
			},
		});
		class ByteArraySubclass extends Array<number> {}
		const withExtraKey = [...valid];
		Object.defineProperty(withExtraKey, "private", { value: true });
		let proxyIndexReads = 0;
		const proxy = new Proxy([...valid], {
			get(target, property, receiver) {
				if (
					typeof property === "string" &&
					/^(?:0|[1-9][0-9]*)$/u.test(property)
				) {
					proxyIndexReads += 1;
				}
				return Reflect.get(target, property, receiver);
			},
		});
		tauri.invoke
			.mockResolvedValueOnce(sparse)
			.mockResolvedValueOnce(accessor)
			.mockResolvedValueOnce(new ByteArraySubclass(...valid))
			.mockResolvedValueOnce(withExtraKey)
			.mockResolvedValueOnce(proxy);
		const bridge = createNativeBridge();

		for (let index = 0; index < 5; index += 1) {
			await expect(
				bridge.workspaceReadFile(rootId, `hostile-${index}.bin`),
			).rejects.toMatchObject({ code: "IPC_CONTRACT_VIOLATION" });
		}
		expect(accessorReads).toBe(0);
		expect(proxyIndexReads).toBe(0);
	});

	it("leaves authorized copy semantics and root state to Rust", async () => {
		const unknownRootId = "00000000-0000-4000-8000-000000000998";
		const revokedRootId = "00000000-0000-4000-8000-000000000999";
		const rootError = {
			code: "ROOT_NOT_AUTHORIZED",
			message: "The workspace root is not authorized.",
		};
		const typeError = {
			code: "ENTRY_TYPE_MISMATCH",
			message: "The workspace entry has an incompatible type.",
		};
		const existsError = {
			code: "ENTRY_ALREADY_EXISTS",
			message: "The workspace entry already exists.",
		};
		const conflictError = {
			code: "WORKSPACE_CONFLICT",
			message: "The workspace copy conflicts with the source path.",
		};
		tauri.invoke
			.mockRejectedValueOnce(rootError)
			.mockRejectedValueOnce(rootError)
			.mockRejectedValueOnce(rootError)
			.mockRejectedValueOnce(rootError)
			.mockRejectedValueOnce(typeError)
			.mockRejectedValueOnce(typeError)
			.mockRejectedValueOnce(existsError)
			.mockRejectedValueOnce(conflictError);
		const bridge = createNativeBridge();
		const cases = [
			[unknownRootId, "", unknownRootId, "target", rootError],
			[unknownRootId, "same", unknownRootId, "same", rootError],
			[unknownRootId, "source", unknownRootId, "source/nested", rootError],
			[rootId, "", revokedRootId, "", rootError],
			[rootId, "", targetRootId, "target", typeError],
			[rootId, "source", targetRootId, "", typeError],
			[rootId, "source", rootId, "source", existsError],
			[rootId, "source", rootId, "source/nested", conflictError],
		] as const;

		for (const [
			sourceRoot,
			sourcePath,
			targetRoot,
			targetPath,
			expected,
		] of cases) {
			await expect(
				bridge.workspaceCopy(sourceRoot, sourcePath, targetRoot, targetPath),
			).rejects.toEqual(expected);
		}

		expect(tauri.invoke.mock.calls).toEqual(
			cases.map(([sourceRootId, sourcePath, targetRootId, targetPath]) => [
				"workspace_copy",
				{
					request: {
						sourceRootId,
						sourcePath,
						targetRootId,
						targetPath,
					},
				},
			]),
		);
		for (const [, arguments_] of tauri.invoke.mock.calls) {
			expect(Object.isFrozen(arguments_?.request)).toBe(true);
		}
	});

	it.each([
		["non-object", "private-non-object"],
		[
			"class instance",
			Object.assign(new (class WorkspacePayload {})(), validSnapshot()),
		],
		["extra snapshot key", { ...validSnapshot(), privatePath: "/secret" }],
		[
			"non-v4 workspace id",
			{
				...validSnapshot(),
				workspaceId: "00000000-0000-3000-8000-000000000001",
			},
		],
		[
			"uppercase root id",
			{
				...validSnapshot(),
				roots: [
					{
						...validRoot(),
						rootId: "00000000-0000-4000-8000-000000000ABC",
					},
				],
			},
		],
		["unsafe revision", { ...validSnapshot(), revision: Number.MAX_VALUE }],
		["negative revision", { ...validSnapshot(), revision: -1 }],
		[
			"duplicate roots",
			{ ...validSnapshot(), roots: [validRoot(), validRoot()] },
		],
		[
			"empty display name",
			{ ...validSnapshot(), roots: [{ ...validRoot(), displayName: "" }] },
		],
		[
			"oversized display name",
			{
				...validSnapshot(),
				roots: [{ ...validRoot(), displayName: "x".repeat(256) }],
			},
		],
		[
			"mismatched root uri",
			{
				...validSnapshot(),
				roots: [{ ...validRoot(), uri: "plain-workspace://elsewhere/" }],
			},
		],
		[
			"extra root key",
			{
				...validSnapshot(),
				roots: [{ ...validRoot(), nativePath: "/private/workspace" }],
			},
		],
	])(
		"rejects malformed snapshots without disclosing payloads: %s",
		async (_name, payload) => {
			tauri.invoke.mockResolvedValueOnce(payload);

			try {
				await createNativeBridge().workspaceSnapshot();
				expect.fail("workspaceSnapshot should reject malformed payloads");
			} catch (error) {
				expect(error).toMatchObject({
					code: "IPC_CONTRACT_VIOLATION",
					message:
						"Native IPC returned a payload that violates the Plain contract.",
				});
				expect((error as Error).message).not.toContain("secret");
				expect((error as Error).message).not.toContain("private");
			}
		},
	);

	it.each(["completed", "SELECTED", null])(
		"rejects an invalid workspace pick status: %s",
		async (status) => {
			tauri.invoke.mockResolvedValueOnce({
				status,
				snapshot: validSnapshot(),
			});

			await expect(
				createNativeBridge().workspacePickRoots("add"),
			).rejects.toMatchObject({ code: "IPC_CONTRACT_VIOLATION" });
			expect(tauri.invoke).toHaveBeenCalledWith("workspace_pick_roots", {
				request: { mode: "add" },
			});
		},
	);

	it("rejects unbounded root arrays", async () => {
		tauri.invoke.mockResolvedValueOnce({
			...validSnapshot(),
			roots: Array.from({ length: 257 }, validRoot),
		});

		await expect(
			createNativeBridge().workspaceSnapshot(),
		).rejects.toMatchObject({ code: "IPC_CONTRACT_VIOLATION" });
	});

	it("attaches an explicitly selected root identity to a Git IPC call", async () => {
		tauri.invoke.mockResolvedValueOnce({
			branch: { oid: "(initial)", head: "(detached)", upstream: null },
			entries: [],
		});

		await createNativeBridge().gitStatus(rootId);

		expect(tauri.invoke).toHaveBeenCalledOnce();
		expect(tauri.invoke).toHaveBeenCalledWith("git_status", {
			rootId,
			request: {},
		});
	});

	it("resolves the sole workspace root for a legacy single-root Git caller", async () => {
		tauri.invoke.mockResolvedValueOnce(validSnapshot()).mockResolvedValueOnce({
			branch: { oid: "(initial)", head: "(detached)", upstream: null },
			entries: [],
		});

		await createNativeBridge().gitStatus();

		expect(tauri.invoke.mock.calls).toEqual([
			["workspace_snapshot", { request: {} }],
			["git_status", { rootId, request: {} }],
		]);
	});

	it("rejects an implicit multi-root Git caller before invoking Git", async () => {
		tauri.invoke.mockResolvedValueOnce({
			...validSnapshot(),
			roots: [
				validRoot(),
				{
					rootId: targetRootId,
					displayName: "second",
					uri: `plain-workspace://${targetRootId}/`,
				},
			],
		});

		await expect(createNativeBridge().gitStatus()).rejects.toMatchObject({
			code: "GIT_ROOT_REQUIRED",
		});
		expect(tauri.invoke).toHaveBeenCalledOnce();
		expect(tauri.invoke).toHaveBeenCalledWith("workspace_snapshot", {
			request: {},
		});
	});

	it("rejects a malformed explicit Git root identity before IPC", async () => {
		await expect(
			createNativeBridge().gitStatus("not-a-root-id"),
		).rejects.toMatchObject({ code: "INVALID_ROOT_ID" });
		expect(tauri.invoke).not.toHaveBeenCalled();
	});
});
