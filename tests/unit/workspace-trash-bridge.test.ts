import { describe, expect, it } from "vitest";

import { createBrowserMockBridge } from "../../app/platform/tauri/browser-mock";

const rootId = "00000000-0000-4000-8000-000000000101";
const secondRootId = "00000000-0000-4000-8000-000000000102";

describe("browser mock workspace Trash bridge", () => {
	it("moves a non-empty directory, file and raw symlink through one ordered batch", async () => {
		const bridge = createBrowserMockBridge();
		await bridge.workspacePickRoots("add");
		const requests = [
			{ rootId, relativePath: "src" },
			{ rootId: secondRootId, relativePath: "notes.txt" },
			{ rootId, relativePath: "fixtures/binary-link" },
		] as const;
		const plan = await bridge.workspacePrepareTrash(requests);

		expect(plan.entries.map(({ kind }) => kind)).toEqual([
			"directory",
			"file",
			"symlink",
		]);
		expect(plan.confirmationId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
		expect(new Set(plan.entries.map(({ entryId }) => entryId)).size).toBe(3);
		expect(Object.isFrozen(plan)).toBe(true);
		expect(Object.isFrozen(plan.entries)).toBe(true);
		expect(plan.entries.every(Object.isFrozen)).toBe(true);

		await bridge.workspaceBeginTrash(plan.confirmationId);
		for (let index = 0; index < requests.length; index += 1) {
			const request = requests[index]!;
			await expect(
				bridge.workspaceCommitTrashEntry(
					plan.confirmationId,
					plan.entries[index]!.entryId,
					request.rootId,
					request.relativePath,
				),
			).resolves.toEqual({ status: "trashed" });
			await expect(
				bridge.workspaceStat(request.rootId, request.relativePath),
			).rejects.toMatchObject({ code: "ENTRY_NOT_FOUND" });
		}
		await expect(
			bridge.workspaceBeginTrash(plan.confirmationId),
		).rejects.toMatchObject({ code: "WORKSPACE_TRASH_PLAN_INVALID" });
	});

	it("supports exactly 64 ordered top-level entries", async () => {
		const bridge = createBrowserMockBridge();
		await bridge.workspacePickRoots("replace");
		for (let index = 0; index < 64; index += 1) {
			await bridge.workspaceCreateFile(rootId, `trash-${index}`);
		}
		const requests = Array.from({ length: 64 }, (_, index) => ({
			rootId,
			relativePath: `trash-${index}`,
		}));
		const plan = await bridge.workspacePrepareTrash(requests);
		expect(plan.entries).toHaveLength(64);
		await bridge.workspaceBeginTrash(plan.confirmationId);
		for (let index = 0; index < requests.length; index += 1) {
			await expect(
				bridge.workspaceCommitTrashEntry(
					plan.confirmationId,
					plan.entries[index]!.entryId,
					rootId,
					requests[index]!.relativePath,
				),
			).resolves.toEqual({ status: "trashed" });
		}
	});

	it("cancels without side effects and shares one mutation-receipt slot with permanent delete", async () => {
		const bridge = createBrowserMockBridge();
		await bridge.workspacePickRoots("replace");
		const trash = await bridge.workspacePrepareTrash([
			{ rootId, relativePath: "README.md" },
		]);
		await expect(
			bridge.workspacePrepareDelete([
				{ rootId, relativePath: "README.md", recursive: false },
			]),
		).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
		await bridge.workspaceCancelTrash(trash.confirmationId);
		expect((await bridge.workspaceStat(rootId, "README.md")).kind).toBe("file");

		const permanent = await bridge.workspacePrepareDelete([
			{ rootId, relativePath: "README.md", recursive: false },
		]);
		await expect(
			bridge.workspacePrepareTrash([{ rootId, relativePath: "README.md" }]),
		).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
		await bridge.workspaceCancelDelete(permanent.confirmationId);
	});

	it("revalidates the whole batch before any simulated OS attempt", async () => {
		const bridge = createBrowserMockBridge();
		await bridge.workspacePickRoots("replace");
		const plan = await bridge.workspacePrepareTrash([
			{ rootId, relativePath: "README.md" },
			{ rootId, relativePath: "binary.bin" },
		]);
		await bridge.workspaceRename(rootId, "binary.bin", "changed.bin");

		await expect(
			bridge.workspaceBeginTrash(plan.confirmationId),
		).rejects.toMatchObject({ code: "WORKSPACE_TRASH_BATCH_CHANGED" });
		expect((await bridge.workspaceStat(rootId, "README.md")).kind).toBe("file");
		expect((await bridge.workspaceStat(rootId, "changed.bin")).kind).toBe(
			"file",
		);
	});

	it.each([
		{ status: "entryRetained", reason: "trashFailed" } as const,
		{ status: "outcomeUnknown" } as const,
	])(
		"stops the remainder after terminal non-success $status",
		async (result) => {
			const bridge = createBrowserMockBridge({
				workspaceTrashResultsForTest: [result],
			});
			await bridge.workspacePickRoots("replace");
			const plan = await bridge.workspacePrepareTrash([
				{ rootId, relativePath: "README.md" },
				{ rootId, relativePath: "binary.bin" },
			]);
			await bridge.workspaceBeginTrash(plan.confirmationId);

			await expect(
				bridge.workspaceCommitTrashEntry(
					plan.confirmationId,
					plan.entries[0]!.entryId,
					rootId,
					"README.md",
				),
			).resolves.toEqual(result);
			await expect(
				bridge.workspaceCommitTrashEntry(
					plan.confirmationId,
					plan.entries[1]!.entryId,
					rootId,
					"binary.bin",
				),
			).rejects.toMatchObject({ code: "WORKSPACE_TRASH_PLAN_INVALID" });
			expect((await bridge.workspaceStat(rootId, "README.md")).kind).toBe(
				"file",
			);
			expect((await bridge.workspaceStat(rootId, "binary.bin")).kind).toBe(
				"file",
			);
		},
	);

	it("expires the Trash receipt at the exact shared monotonic deadline", async () => {
		let now = 1_000;
		const bridge = createBrowserMockBridge({
			workspaceDeleteClockForTest: () => now,
		});
		await bridge.workspacePickRoots("replace");
		const plan = await bridge.workspacePrepareTrash([
			{ rootId, relativePath: "README.md" },
		]);
		now += 120_000;
		await expect(
			bridge.workspaceBeginTrash(plan.confirmationId),
		).rejects.toMatchObject({ code: "WORKSPACE_TRASH_PLAN_INVALID" });
		expect((await bridge.workspaceStat(rootId, "README.md")).kind).toBe("file");
	});
});
