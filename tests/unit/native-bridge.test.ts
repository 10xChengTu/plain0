import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
	invoke: vi.fn(),
	listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauri.listen }));

import { createNativeBridge } from "../../app/platform/tauri/native";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const rootId = "00000000-0000-4000-8000-000000000101";

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

describe("native Plain bridge", () => {
	beforeEach(() => {
		tauri.invoke.mockReset();
		tauri.listen.mockReset();
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

	it("invokes the bounded file commands with frozen owned requests", async () => {
		const rawBytes = new Uint8Array([0, 255, 128, 42]);
		tauri.invoke
			.mockResolvedValueOnce({
				kind: "file",
				size: 4,
				mtime: 1_700_000_000_000,
				ctime: 0,
			})
			.mockResolvedValueOnce({
				entries: [
					{ name: "%2F", kind: "file" },
					{ name: "%2e%2e", kind: "directory" },
				],
			})
			.mockResolvedValueOnce(rawBytes.buffer);
		const bridge = createNativeBridge();

		const stat = await bridge.workspaceStat(rootId, "%2e%2e/file.bin");
		const directory = await bridge.workspaceReadDirectory(rootId, "%2e%2e");
		const file = await bridge.workspaceReadFile(rootId, "%2F");

		expect(tauri.invoke.mock.calls).toEqual([
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
		expect(stat).toEqual({
			kind: "file",
			size: 4,
			mtime: 1_700_000_000_000,
			ctime: 0,
		});
		expect(Object.isFrozen(stat)).toBe(true);
		expect(directory.entries.map(({ name }) => name)).toEqual([
			"%2F",
			"%2e%2e",
		]);
		expect(Object.isFrozen(directory.entries)).toBe(true);
		rawBytes[0] = 99;
		expect([...file.copy()]).toEqual([0, 255, 128, 42]);
	});

	it("supports strict number-array fallback bytes and rejects invalid requests before invoke", async () => {
		tauri.invoke.mockResolvedValueOnce([1, 2, 3]);
		const bridge = createNativeBridge();
		expect([
			...(await bridge.workspaceReadFile(rootId, "binary.bin")).copy(),
		]).toEqual([1, 2, 3]);

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
		expect(tauri.invoke).not.toHaveBeenCalled();
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
});
