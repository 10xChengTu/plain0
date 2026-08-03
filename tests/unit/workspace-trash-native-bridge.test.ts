import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import { createNativeBridge } from "../../app/platform/tauri/native";

const rootId = "00000000-0000-4000-8000-000000000101";
const confirmationId = "20000000-0000-4000-8000-000000000001";
const entryId = "20000000-0000-4000-8000-000000000002";

describe("native workspace Trash bridge", () => {
	beforeEach(() => tauri.invoke.mockReset());

	it("invokes the independent four-command protocol with frozen DTOs", async () => {
		tauri.invoke
			.mockResolvedValueOnce({
				confirmationId,
				entries: [{ entryId, kind: "directory" }],
			})
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ status: "trashed" });
		const bridge = createNativeBridge();

		const plan = await bridge.workspacePrepareTrash([
			{ rootId, relativePath: "src" },
		]);
		await bridge.workspaceCancelTrash(confirmationId);
		await bridge.workspaceBeginTrash(confirmationId);
		const result = await bridge.workspaceCommitTrashEntry(
			confirmationId,
			entryId,
			rootId,
			"src",
		);

		expect(tauri.invoke.mock.calls).toEqual([
			[
				"workspace_prepare_trash",
				{
					request: {
						entries: [{ rootId, relativePath: "src" }],
					},
				},
			],
			["workspace_cancel_trash", { request: { confirmationId } }],
			["workspace_begin_trash", { request: { confirmationId } }],
			[
				"workspace_commit_trash_entry",
				{
					request: {
						confirmationId,
						entryId,
						rootId,
						relativePath: "src",
					},
				},
			],
		]);
		for (const [, args] of tauri.invoke.mock.calls) {
			expect(Object.isFrozen(args.request)).toBe(true);
		}
		expect(
			Object.isFrozen(tauri.invoke.mock.calls[0]![1].request.entries),
		).toBe(true);
		expect(plan).toEqual({
			confirmationId,
			entries: [{ entryId, kind: "directory" }],
		});
		expect(Object.isFrozen(plan)).toBe(true);
		expect(Object.isFrozen(plan.entries)).toBe(true);
		expect(result).toEqual({ status: "trashed" });
		expect(Object.isFrozen(result)).toBe(true);
	});

	it("requires null cancel/begin responses and strict plan/result payloads", async () => {
		tauri.invoke
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ confirmationId, entries: [] })
			.mockResolvedValueOnce({
				status: "entryRetained",
				reason: "deleteFailed",
			});
		const bridge = createNativeBridge();

		await expect(
			bridge.workspaceCancelTrash(confirmationId),
		).rejects.toMatchObject({ code: "IPC_CONTRACT_VIOLATION" });
		await expect(
			bridge.workspaceBeginTrash(confirmationId),
		).rejects.toMatchObject({ code: "IPC_CONTRACT_VIOLATION" });
		await expect(
			bridge.workspacePrepareTrash([{ rootId, relativePath: "README.md" }]),
		).rejects.toMatchObject({ code: "IPC_CONTRACT_VIOLATION" });
		await expect(
			bridge.workspaceCommitTrashEntry(
				confirmationId,
				entryId,
				rootId,
				"README.md",
			),
		).rejects.toMatchObject({ code: "IPC_CONTRACT_VIOLATION" });
	});

	it("never invokes native commands for malformed local Trash requests", async () => {
		const bridge = createNativeBridge();
		await expect(
			bridge.workspacePrepareTrash([
				{ rootId, relativePath: "src" },
				{ rootId, relativePath: "src/main.ts" },
			]),
		).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
		await expect(
			bridge.workspaceCommitTrashEntry(
				confirmationId,
				confirmationId,
				rootId,
				"README.md",
			),
		).rejects.toMatchObject({ code: "WORKSPACE_TRASH_PLAN_INVALID" });
		expect(tauri.invoke).not.toHaveBeenCalled();
	});
});
