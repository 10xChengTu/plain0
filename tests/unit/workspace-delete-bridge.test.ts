import { describe, expect, it } from "vitest";

import {
	createBrowserMockBridge,
	type BrowserMockWorkspaceDeleteObservation,
} from "../../app/platform/tauri/browser-mock";

const rootId = "00000000-0000-4000-8000-000000000101";
const secondRootId = "00000000-0000-4000-8000-000000000102";

describe("browser mock workspace delete bridge", () => {
	it("prepares, begins and permanently deletes one file with one-shot ids", async () => {
		const bridge = createBrowserMockBridge();
		await bridge.workspacePickRoots("replace");
		const plan = await bridge.workspacePrepareDelete([
			{ rootId, relativePath: "README.md", recursive: false },
		]);

		expect(plan.entries).toHaveLength(1);
		expect(plan.entries[0]).toMatchObject({
			kind: "file",
			descendantEntries: 0,
		});
		expect(plan.confirmationId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
		expect(plan.entries[0]!.entryId).not.toBe(plan.confirmationId);
		expect(Object.isFrozen(plan)).toBe(true);
		expect(Object.isFrozen(plan.entries)).toBe(true);
		expect(plan.entries.every(Object.isFrozen)).toBe(true);

		await bridge.workspaceBeginDelete(plan.confirmationId);
		await expect(
			bridge.workspaceCommitDeleteEntry(
				plan.confirmationId,
				plan.entries[0]!.entryId,
				rootId,
				"README.md",
				false,
			),
		).resolves.toEqual({ status: "deleted" });
		await expect(
			bridge.workspaceStat(rootId, "README.md"),
		).rejects.toMatchObject({ code: "ENTRY_NOT_FOUND" });
		await expect(
			bridge.workspaceCommitDeleteEntry(
				plan.confirmationId,
				plan.entries[0]!.entryId,
				rootId,
				"README.md",
				false,
			),
		).rejects.toMatchObject({ code: "WORKSPACE_DELETE_PLAN_INVALID" });
	});

	it("keeps opaque delete ids independent across browser-mock windows", async () => {
		const first = createBrowserMockBridge();
		const second = createBrowserMockBridge();
		await first.workspacePickRoots("replace");
		await second.workspacePickRoots("replace");
		const firstPlan = await first.workspacePrepareDelete([
			{ rootId, relativePath: "README.md", recursive: false },
		]);
		const secondPlan = await second.workspacePrepareDelete([
			{ rootId, relativePath: "README.md", recursive: false },
		]);

		expect(firstPlan.confirmationId).not.toBe(secondPlan.confirmationId);
		expect(firstPlan.entries[0]!.entryId).not.toBe(
			secondPlan.entries[0]!.entryId,
		);
		await expect(
			second.workspaceBeginDelete(firstPlan.confirmationId),
		).rejects.toMatchObject({ code: "WORKSPACE_DELETE_PLAN_INVALID" });
		await expect(
			second.workspaceBeginDelete(secondPlan.confirmationId),
		).resolves.toBeUndefined();
	});

	it("supports a 64-entry ordered batch and rejects a second active batch", async () => {
		const bridge = createBrowserMockBridge();
		await bridge.workspacePickRoots("replace");
		for (let index = 0; index < 64; index += 1) {
			await bridge.workspaceCreateFile(rootId, `batch-${index}`);
		}
		const requests = Array.from({ length: 64 }, (_, index) => ({
			rootId,
			relativePath: `batch-${index}`,
			recursive: false,
		}));
		const plan = await bridge.workspacePrepareDelete(requests);
		expect(plan.entries).toHaveLength(64);
		expect(new Set(plan.entries.map(({ entryId }) => entryId)).size).toBe(64);
		await expect(
			bridge.workspacePrepareDelete([
				{ rootId, relativePath: "README.md", recursive: false },
			]),
		).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });

		await bridge.workspaceBeginDelete(plan.confirmationId);
		for (let index = 0; index < requests.length; index += 1) {
			const request = requests[index]!;
			await expect(
				bridge.workspaceCommitDeleteEntry(
					plan.confirmationId,
					plan.entries[index]!.entryId,
					request.rootId,
					request.relativePath,
					request.recursive,
				),
			).resolves.toEqual({ status: "deleted" });
		}
	});

	it("deletes a mixed raw-symlink/file/empty-directory batch across roots", async () => {
		const bridge = createBrowserMockBridge();
		await bridge.workspacePickRoots("add");
		const requests = [
			{
				rootId,
				relativePath: "fixtures/binary-link",
				recursive: false,
			},
			{
				rootId: secondRootId,
				relativePath: "notes.txt",
				recursive: false,
			},
			{ rootId, relativePath: "empty", recursive: false },
		] as const;
		const plan = await bridge.workspacePrepareDelete(requests);
		expect(plan.entries.map(({ kind }) => kind)).toEqual([
			"symlink",
			"file",
			"directory",
		]);
		expect(
			plan.entries.every(({ descendantEntries }) => descendantEntries === 0),
		).toBe(true);
		await bridge.workspaceBeginDelete(plan.confirmationId);
		for (let index = 0; index < requests.length; index += 1) {
			const request = requests[index]!;
			await expect(
				bridge.workspaceCommitDeleteEntry(
					plan.confirmationId,
					plan.entries[index]!.entryId,
					request.rootId,
					request.relativePath,
					request.recursive,
				),
			).resolves.toEqual({ status: "deleted" });
			await expect(
				bridge.workspaceStat(request.rootId, request.relativePath),
			).rejects.toMatchObject({ code: "ENTRY_NOT_FOUND" });
		}
	});

	it("cancels without side effects and makes the token indistinguishable", async () => {
		const bridge = createBrowserMockBridge();
		await bridge.workspacePickRoots("replace");
		const plan = await bridge.workspacePrepareDelete([
			{ rootId, relativePath: "README.md", recursive: false },
		]);
		await bridge.workspaceCancelDelete(plan.confirmationId);
		expect((await bridge.workspaceStat(rootId, "README.md")).kind).toBe("file");
		for (const operation of [
			() => bridge.workspaceCancelDelete(plan.confirmationId),
			() => bridge.workspaceBeginDelete(plan.confirmationId),
		]) {
			await expect(operation()).rejects.toMatchObject({
				code: "WORKSPACE_DELETE_PLAN_INVALID",
			});
		}
	});

	it("expires the per-instance batch with an injectable monotonic clock", async () => {
		let now = 1_000;
		const bridge = createBrowserMockBridge({
			workspaceDeleteClockForTest: () => now,
		});
		await bridge.workspacePickRoots("replace");
		const plan = await bridge.workspacePrepareDelete([
			{ rootId, relativePath: "README.md", recursive: false },
		]);
		now += 120_000;
		await expect(
			bridge.workspaceBeginDelete(plan.confirmationId),
		).rejects.toMatchObject({ code: "WORKSPACE_DELETE_PLAN_INVALID" });
		expect((await bridge.workspaceStat(rootId, "README.md")).kind).toBe("file");
	});

	it("starts the TTL after prepare revalidation and observer work completes", async () => {
		let now = 0;
		const bridge = createBrowserMockBridge({
			workspaceDeleteClockForTest: () => now,
			onWorkspaceDeletePreparedForTest: () => {
				now = 100_000;
			},
		});
		await bridge.workspacePickRoots("replace");
		const plan = await bridge.workspacePrepareDelete([
			{ rootId, relativePath: "README.md", recursive: false },
		]);
		now = 150_000;
		await expect(
			bridge.workspaceBeginDelete(plan.confirmationId),
		).resolves.toBeUndefined();
		await bridge.workspaceCancelDelete(plan.confirmationId);
	});

	it("whole-batch begin catches a later entry change before any remove", async () => {
		const bridge = createBrowserMockBridge();
		await bridge.workspacePickRoots("replace");
		const plan = await bridge.workspacePrepareDelete([
			{ rootId, relativePath: "README.md", recursive: false },
			{ rootId, relativePath: "binary.bin", recursive: false },
		]);
		await bridge.workspaceRename(rootId, "binary.bin", "changed.bin");
		await expect(
			bridge.workspaceBeginDelete(plan.confirmationId),
		).rejects.toMatchObject({ code: "WORKSPACE_DELETE_BATCH_CHANGED" });
		expect((await bridge.workspaceStat(rootId, "README.md")).kind).toBe("file");
		expect((await bridge.workspaceStat(rootId, "changed.bin")).kind).toBe(
			"file",
		);
	});

	it("rejects a top-level basename round trip after prepare", async () => {
		const bridge = createBrowserMockBridge();
		await bridge.workspacePickRoots("replace");
		const plan = await bridge.workspacePrepareDelete([
			{ rootId, relativePath: "README.md", recursive: false },
		]);

		await bridge.workspaceRename(rootId, "README.md", "round-trip.tmp");
		await bridge.workspaceRename(rootId, "round-trip.tmp", "README.md");

		await expect(
			bridge.workspaceBeginDelete(plan.confirmationId),
		).rejects.toMatchObject({ code: "WORKSPACE_DELETE_BATCH_CHANGED" });
		expect((await bridge.workspaceStat(rootId, "README.md")).kind).toBe("file");
	});

	it("returns retained when the entry changes before its first remove", async () => {
		let mutated = false;
		const bridge = createBrowserMockBridge({
			onWorkspaceDeleteBeforeRemoveForTest: (_observation, mutations) => {
				if (!mutated) {
					mutated = true;
					mutations.replaceFile(rootId, "README.md", [1, 2, 3]);
				}
			},
		});
		await bridge.workspacePickRoots("replace");
		const plan = await bridge.workspacePrepareDelete([
			{ rootId, relativePath: "README.md", recursive: false },
		]);
		await bridge.workspaceBeginDelete(plan.confirmationId);
		const result = await bridge.workspaceCommitDeleteEntry(
			plan.confirmationId,
			plan.entries[0]!.entryId,
			rootId,
			"README.md",
			false,
		);
		expect(result).toEqual({
			status: "entryRetained",
			reason: "entryChanged",
		});
		expect(Object.isFrozen(result)).toBe(true);
		expect(
			(await bridge.workspaceReadFile(rootId, "README.md")).copy(),
		).toEqual(new Uint8Array([1, 2, 3]));
	});

	it("contains observer exceptions as retained/partial unverifiable results", async () => {
		const retained = createBrowserMockBridge({
			onWorkspaceDeleteBeforeRemoveForTest: () => {
				throw new Error("observer");
			},
		});
		await retained.workspacePickRoots("replace");
		const retainedPlan = await retained.workspacePrepareDelete([
			{ rootId, relativePath: "README.md", recursive: false },
		]);
		await retained.workspaceBeginDelete(retainedPlan.confirmationId);
		await expect(
			retained.workspaceCommitDeleteEntry(
				retainedPlan.confirmationId,
				retainedPlan.entries[0]!.entryId,
				rootId,
				"README.md",
				false,
			),
		).resolves.toEqual({
			status: "entryRetained",
			reason: "entryUnverifiable",
		});

		const partial = createBrowserMockBridge({
			onWorkspaceDeleteAfterRemoveForTest: () => {
				throw new Error("observer");
			},
		});
		await partial.workspacePickRoots("replace");
		const partialPlan = await partial.workspacePrepareDelete([
			{ rootId, relativePath: "src", recursive: true },
		]);
		await partial.workspaceBeginDelete(partialPlan.confirmationId);
		await expect(
			partial.workspaceCommitDeleteEntry(
				partialPlan.confirmationId,
				partialPlan.entries[0]!.entryId,
				rootId,
				"src",
				true,
			),
		).resolves.toEqual({
			status: "entryPartiallyDeleted",
			reason: "entryUnverifiable",
			removedEntries: 1,
		});
	});

	it("reports exact partial count when the top-level remove syscall fails", async () => {
		const bridge = createBrowserMockBridge({
			onWorkspaceDeleteRemoveForTest: (observation) => {
				if (observation.isRoot) {
					throw new Error("remove failed");
				}
			},
		});
		await bridge.workspacePickRoots("replace");
		const plan = await bridge.workspacePrepareDelete([
			{ rootId, relativePath: "src", recursive: true },
		]);
		await bridge.workspaceBeginDelete(plan.confirmationId);
		await expect(
			bridge.workspaceCommitDeleteEntry(
				plan.confirmationId,
				plan.entries[0]!.entryId,
				rootId,
				"src",
				true,
			),
		).resolves.toEqual({
			status: "entryPartiallyDeleted",
			reason: "deleteFailed",
			removedEntries: 1,
		});
		expect(
			(await bridge.workspaceReadDirectory(rootId, "src")).entries,
		).toEqual([]);
	});

	it("rebaselines shared inode metadata while deleting hardlink aliases", async () => {
		const bridge = createBrowserMockBridge({
			directoryCopyFixtureForTest: {
				name: "delete-hardlinks",
				entries: [
					{ path: ["original"], kind: "file", bytes: [1, 2] },
					{
						path: ["alias"],
						kind: "hardlink",
						targetPath: ["original"],
					},
				],
			},
		});
		await bridge.workspacePickRoots("replace");
		const plan = await bridge.workspacePrepareDelete([
			{ rootId, relativePath: "delete-hardlinks", recursive: true },
		]);
		expect(plan.entries[0]).toMatchObject({
			kind: "directory",
			descendantEntries: 2,
		});
		await bridge.workspaceBeginDelete(plan.confirmationId);
		await expect(
			bridge.workspaceCommitDeleteEntry(
				plan.confirmationId,
				plan.entries[0]!.entryId,
				rootId,
				"delete-hardlinks",
				true,
			),
		).resolves.toEqual({ status: "deleted" });
	});

	it("rejects two top-level hardlink aliases and non-recursive/special trees", async () => {
		const bridge = createBrowserMockBridge({
			directoryCopyFixtureForTest: {
				name: "delete-fixture",
				entries: [
					{ path: ["original"], kind: "file", bytes: [1] },
					{
						path: ["alias"],
						kind: "hardlink",
						targetPath: ["original"],
					},
					{ path: ["special"], kind: "other" },
				],
			},
		});
		await bridge.workspacePickRoots("replace");
		await expect(
			bridge.workspacePrepareDelete([
				{
					rootId,
					relativePath: "delete-fixture/original",
					recursive: false,
				},
				{
					rootId,
					relativePath: "delete-fixture/alias",
					recursive: false,
				},
			]),
		).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
		await expect(
			bridge.workspacePrepareDelete([
				{ rootId, relativePath: "src", recursive: false },
			]),
		).rejects.toMatchObject({ code: "DIRECTORY_NOT_EMPTY" });
		await expect(
			bridge.workspacePrepareDelete([
				{
					rootId,
					relativePath: "delete-fixture/special",
					recursive: false,
				},
			]),
		).rejects.toMatchObject({ code: "ENTRY_TYPE_MISMATCH" });
	});

	it("rejects a top identity contained by another top directory manifest", async () => {
		const bridge = createBrowserMockBridge({
			directoryCopyFixtureForTest: {
				name: "manifest-conflict",
				entries: [
					{ path: ["inside"], kind: "directory" },
					{
						path: ["inside", "original"],
						kind: "file",
						bytes: [1],
					},
					{
						path: ["alias"],
						kind: "hardlink",
						targetPath: ["inside", "original"],
					},
				],
			},
		});
		await bridge.workspacePickRoots("replace");
		await expect(
			bridge.workspacePrepareDelete([
				{
					rootId,
					relativePath: "manifest-conflict/inside",
					recursive: true,
				},
				{
					rootId,
					relativePath: "manifest-conflict/alias",
					recursive: false,
				},
			]),
		).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
	});

	it("rejects a hardlink identity shared by two top directory manifests", async () => {
		const bridge = createBrowserMockBridge({
			directoryCopyFixtureForTest: {
				name: "cross-top-hardlink",
				entries: [
					{ path: ["left"], kind: "directory" },
					{ path: ["right"], kind: "directory" },
					{
						path: ["left", "original"],
						kind: "file",
						bytes: [1],
					},
					{
						path: ["right", "alias"],
						kind: "hardlink",
						targetPath: ["left", "original"],
					},
				],
			},
		});
		await bridge.workspacePickRoots("replace");
		await expect(
			bridge.workspacePrepareDelete([
				{
					rootId,
					relativePath: "cross-top-hardlink/left",
					recursive: true,
				},
				{
					rootId,
					relativePath: "cross-top-hardlink/right",
					recursive: true,
				},
			]),
		).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
	});

	it("enforces the aggregate namespace budget without file-content limits", async () => {
		const bridge = createBrowserMockBridge({
			workspaceDeleteLimitsForTest: { descendants: 1 },
			directoryCopyFixtureForTest: {
				name: "delete-budget",
				entries: [
					{ path: ["a"], kind: "file", bytes: [1] },
					{ path: ["b"], kind: "file", bytes: [2] },
				],
			},
		});
		await bridge.workspacePickRoots("replace");
		await expect(
			bridge.workspacePrepareDelete([
				{ rootId, relativePath: "delete-budget", recursive: true },
			]),
		).rejects.toMatchObject({ code: "DIRECTORY_TOO_LARGE" });

		const unrestricted = createBrowserMockBridge();
		await unrestricted.workspacePickRoots("replace");
		await expect(
			unrestricted.workspacePrepareDelete([
				{
					rootId,
					relativePath: "fixtures/oversized.bin",
					recursive: false,
				},
			]),
		).resolves.toMatchObject({
			entries: [{ kind: "file", descendantEntries: 0 }],
		});
	});

	it("ignores external parent siblings while exposing only frozen safe observations", async () => {
		const observations: BrowserMockWorkspaceDeleteObservation[] = [];
		let added = false;
		const bridge = createBrowserMockBridge({
			onWorkspaceDeleteBeforeRemoveForTest: (observation, mutations) => {
				observations.push(observation);
				if (!added) {
					added = true;
					mutations.addFile(rootId, "new-sibling", [9]);
				}
			},
		});
		await bridge.workspacePickRoots("replace");
		const plan = await bridge.workspacePrepareDelete([
			{ rootId, relativePath: "README.md", recursive: false },
		]);
		await bridge.workspaceBeginDelete(plan.confirmationId);
		await expect(
			bridge.workspaceCommitDeleteEntry(
				plan.confirmationId,
				plan.entries[0]!.entryId,
				rootId,
				"README.md",
				false,
			),
		).resolves.toEqual({ status: "deleted" });
		expect((await bridge.workspaceStat(rootId, "new-sibling")).kind).toBe(
			"file",
		);
		expect(observations).toHaveLength(1);
		expect(Object.isFrozen(observations[0])).toBe(true);
		expect(Object.keys(observations[0]!)).not.toContain("relativePath");
		expect(JSON.stringify(observations)).not.toContain("README.md");
	});

	it("invalidates prepared tokens on root lifecycle changes and mismatched commit", async () => {
		const bridge = createBrowserMockBridge();
		await bridge.workspacePickRoots("replace");
		const revoked = await bridge.workspacePrepareDelete([
			{ rootId, relativePath: "README.md", recursive: false },
		]);
		await bridge.workspaceRemoveRoot(rootId);
		await expect(
			bridge.workspaceBeginDelete(revoked.confirmationId),
		).rejects.toMatchObject({ code: "WORKSPACE_DELETE_PLAN_INVALID" });

		await bridge.workspacePickRoots("replace");
		const mismatch = await bridge.workspacePrepareDelete([
			{ rootId, relativePath: "README.md", recursive: false },
		]);
		await bridge.workspaceBeginDelete(mismatch.confirmationId);
		await expect(
			bridge.workspaceCommitDeleteEntry(
				mismatch.confirmationId,
				mismatch.entries[0]!.entryId,
				rootId,
				"binary.bin",
				false,
			),
		).rejects.toMatchObject({ code: "WORKSPACE_DELETE_PLAN_INVALID" });
		await expect(
			bridge.workspaceCommitDeleteEntry(
				mismatch.confirmationId,
				mismatch.entries[0]!.entryId,
				rootId,
				"README.md",
				false,
			),
		).rejects.toMatchObject({ code: "WORKSPACE_DELETE_PLAN_INVALID" });
		expect((await bridge.workspaceStat(rootId, "README.md")).kind).toBe("file");
	});

	it("invalidates a batch after every successful picker selection, even unchanged", async () => {
		const bridge = createBrowserMockBridge();
		await bridge.workspacePickRoots("replace");
		const plan = await bridge.workspacePrepareDelete([
			{ rootId, relativePath: "README.md", recursive: false },
		]);
		const picked = await bridge.workspacePickRoots("replace");
		expect(picked.status).toBe("selected");
		await expect(
			bridge.workspaceBeginDelete(plan.confirmationId),
		).rejects.toMatchObject({ code: "WORKSPACE_DELETE_PLAN_INVALID" });
	});

	it("keeps receipt comparisons linear during a wide directory delete", async () => {
		let receiptVisits = 0;
		const bridge = createBrowserMockBridge({
			directoryCopyFixtureForTest: {
				name: "wide-delete",
				entries: Array.from({ length: 100 }, (_, index) => ({
					path: [`file-${String(index).padStart(3, "0")}`],
					kind: "file" as const,
					bytes: [index % 256],
				})),
			},
			onWorkspaceDeleteReceiptVisitForTest: () => {
				receiptVisits += 1;
			},
		});
		await bridge.workspacePickRoots("replace");
		const plan = await bridge.workspacePrepareDelete([
			{ rootId, relativePath: "wide-delete", recursive: true },
		]);
		await bridge.workspaceBeginDelete(plan.confirmationId);
		await expect(
			bridge.workspaceCommitDeleteEntry(
				plan.confirmationId,
				plan.entries[0]!.entryId,
				rootId,
				"wide-delete",
				true,
			),
		).resolves.toEqual({ status: "deleted" });
		expect(receiptVisits).toBeGreaterThanOrEqual(300);
		expect(receiptVisits).toBeLessThan(1_000);
	});
});
