import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import { createNativeBridge } from "../../app/platform/tauri/native";

const rootId = "00000000-0000-4000-8000-000000000101";
const confirmationId = "10000000-0000-4000-8000-000000000001";
const entryId = "10000000-0000-4000-8000-000000000002";

describe("native workspace delete bridge", () => {
	beforeEach(() => tauri.invoke.mockReset());

	it("invokes prepare/cancel/begin/commit with frozen owned DTOs", async () => {
		tauri.invoke
			.mockResolvedValueOnce({
				confirmationId,
				entries: [{ entryId, kind: "directory", descendantEntries: 1 }],
			})
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ status: "deleted" });
		const bridge = createNativeBridge();

		const plan = await bridge.workspacePrepareDelete([
			{ rootId, relativePath: "src", recursive: true },
		]);
		await bridge.workspaceCancelDelete(confirmationId);
		await bridge.workspaceBeginDelete(confirmationId);
		const result = await bridge.workspaceCommitDeleteEntry(
			confirmationId,
			entryId,
			rootId,
			"src",
			true,
		);

		expect(tauri.invoke.mock.calls).toEqual([
			[
				"workspace_prepare_delete",
				{
					request: {
						entries: [{ rootId, relativePath: "src", recursive: true }],
					},
				},
			],
			["workspace_cancel_delete", { request: { confirmationId } }],
			["workspace_begin_delete", { request: { confirmationId } }],
			[
				"workspace_commit_delete_entry",
				{
					request: {
						confirmationId,
						entryId,
						rootId,
						relativePath: "src",
						recursive: true,
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
			entries: [{ entryId, kind: "directory", descendantEntries: 1 }],
		});
		expect(Object.isFrozen(plan)).toBe(true);
		expect(Object.isFrozen(plan.entries)).toBe(true);
		expect(result).toEqual({ status: "deleted" });
		expect(Object.isFrozen(result)).toBe(true);
	});

	it("requires null cancel/begin responses and strict plan/result payloads", async () => {
		tauri.invoke
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({
				confirmationId,
				entries: [],
			})
			.mockResolvedValueOnce({
				status: "entryPartiallyDeleted",
				reason: "deleteFailed",
				removedEntries: 0,
			});
		const bridge = createNativeBridge();

		await expect(
			bridge.workspaceCancelDelete(confirmationId),
		).rejects.toMatchObject({ code: "IPC_CONTRACT_VIOLATION" });
		await expect(
			bridge.workspaceBeginDelete(confirmationId),
		).rejects.toMatchObject({ code: "IPC_CONTRACT_VIOLATION" });
		await expect(
			bridge.workspacePrepareDelete([
				{ rootId, relativePath: "README.md", recursive: false },
			]),
		).rejects.toMatchObject({ code: "IPC_CONTRACT_VIOLATION" });
		await expect(
			bridge.workspaceCommitDeleteEntry(
				confirmationId,
				entryId,
				rootId,
				"README.md",
				false,
			),
		).rejects.toMatchObject({ code: "IPC_CONTRACT_VIOLATION" });
	});

	it("does not invoke native commands for malformed local delete requests", async () => {
		const bridge = createNativeBridge();
		await expect(
			bridge.workspacePrepareDelete([
				{ rootId, relativePath: "src", recursive: true },
				{ rootId, relativePath: "src/main.ts", recursive: false },
			]),
		).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
		await expect(
			bridge.workspaceCommitDeleteEntry(
				confirmationId,
				confirmationId,
				rootId,
				"README.md",
				false,
			),
		).rejects.toMatchObject({ code: "WORKSPACE_DELETE_PLAN_INVALID" });
		expect(tauri.invoke).not.toHaveBeenCalled();
	});
});
