import { describe, expect, it } from "vitest";

import {
	decodeWorkspaceTrashBatchPlan,
	decodeWorkspaceTrashResult,
	frozenWorkspaceCommitTrashEntryRequest,
	frozenWorkspacePrepareTrashRequest,
	frozenWorkspaceTrashBatchRequest,
} from "../../app/platform/tauri/workspace-codec";

const rootId = "00000000-0000-4000-8000-000000000101";
const secondRootId = "00000000-0000-4000-8000-000000000102";
const confirmationId = "20000000-0000-4000-8000-000000000001";
const entryId = "20000000-0000-4000-8000-000000000002";
const contractError = { code: "IPC_CONTRACT_VIOLATION" };
const invalidPlan = { code: "WORKSPACE_TRASH_PLAN_INVALID" };

describe("workspace Trash codec", () => {
	it("builds a detached, deeply frozen and bounded prepare request", () => {
		const input = [
			{ rootId, relativePath: "README.md" },
			{ rootId: secondRootId, relativePath: "src" },
		];
		const request = frozenWorkspacePrepareTrashRequest(input);

		expect(request).toEqual({ entries: input });
		expect(request.entries).not.toBe(input);
		expect(Object.isFrozen(request)).toBe(true);
		expect(Object.isFrozen(request.entries)).toBe(true);
		expect(request.entries.every(Object.isFrozen)).toBe(true);
		input[0]!.relativePath = "changed";
		expect(request.entries[0]!.relativePath).toBe("README.md");
		expect(
			frozenWorkspacePrepareTrashRequest(
				Array.from({ length: 64 }, (_, index) => ({
					rootId,
					relativePath: `entry-${index}`,
				})),
			).entries,
		).toHaveLength(64);
	});

	it("rejects empty, oversized, overlapping, extra-field, accessor and Proxy inputs", () => {
		for (const [input, code] of [
			[[], "WORKSPACE_CONFLICT"],
			[
				Array.from({ length: 65 }, (_, index) => ({
					rootId,
					relativePath: `entry-${index}`,
				})),
				"WORKSPACE_CONFLICT",
			],
			[[{ rootId, relativePath: "" }], "ENTRY_TYPE_MISMATCH"],
			[
				[{ rootId, relativePath: "README.md", recursive: true }],
				"WORKSPACE_TRASH_PLAN_INVALID",
			],
			[
				[
					{ rootId, relativePath: "src" },
					{ rootId, relativePath: "src/main.ts" },
				],
				"WORKSPACE_CONFLICT",
			],
		] as const) {
			expect(() => frozenWorkspacePrepareTrashRequest(input)).toThrowError(
				expect.objectContaining({ code }),
			);
		}

		let reads = 0;
		const accessor = Object.defineProperty({ rootId }, "relativePath", {
			enumerable: true,
			get() {
				reads += 1;
				return "README.md";
			},
		});
		for (const input of [
			[accessor],
			[new Proxy({ rootId, relativePath: "README.md" }, {})],
			new Proxy([{ rootId, relativePath: "README.md" }], {}),
		]) {
			expect(() => frozenWorkspacePrepareTrashRequest(input)).toThrowError(
				expect.objectContaining(invalidPlan),
			);
		}
		expect(reads).toBe(0);
	});

	it("builds strict batch and commit requests without a permanent-delete flag", () => {
		expect(frozenWorkspaceTrashBatchRequest(confirmationId)).toEqual({
			confirmationId,
		});
		const commit = frozenWorkspaceCommitTrashEntryRequest(
			confirmationId,
			entryId,
			rootId,
			"src",
		);
		expect(commit).toEqual({
			confirmationId,
			entryId,
			rootId,
			relativePath: "src",
		});
		expect(Object.isFrozen(commit)).toBe(true);
		for (const operation of [
			() => frozenWorkspaceTrashBatchRequest("not-a-token"),
			() =>
				frozenWorkspaceCommitTrashEntryRequest(
					confirmationId,
					confirmationId,
					rootId,
					"src",
				),
		]) {
			expect(operation).toThrowError(expect.objectContaining(invalidPlan));
		}
	});

	it("decodes only a same-length, unique and deeply frozen path-free plan", () => {
		const request = frozenWorkspacePrepareTrashRequest([
			{ rootId, relativePath: "README.md" },
			{ rootId, relativePath: "src" },
		]);
		const plan = decodeWorkspaceTrashBatchPlan(
			{
				confirmationId,
				entries: [
					{ entryId, kind: "file" },
					{
						entryId: "20000000-0000-4000-8000-000000000003",
						kind: "directory",
					},
				],
			},
			request,
		);
		expect(Object.isFrozen(plan)).toBe(true);
		expect(Object.isFrozen(plan.entries)).toBe(true);
		expect(plan.entries.every(Object.isFrozen)).toBe(true);

		for (const payload of [
			{ confirmationId, entries: [] },
			{
				confirmationId,
				entries: [
					{ entryId, kind: "file" },
					{ entryId, kind: "directory" },
				],
			},
			{
				confirmationId,
				entries: [
					{ entryId, kind: "file", nativePath: "/tmp/private" },
					{
						entryId: "20000000-0000-4000-8000-000000000003",
						kind: "directory",
					},
				],
			},
			{
				confirmationId,
				entries: [
					{ entryId, kind: "other" },
					{
						entryId: "20000000-0000-4000-8000-000000000003",
						kind: "directory",
					},
				],
			},
			new Proxy(
				{
					confirmationId,
					entries: [
						{ entryId, kind: "file" },
						{
							entryId: "20000000-0000-4000-8000-000000000003",
							kind: "directory",
						},
					],
				},
				{},
			),
		]) {
			expect(() =>
				decodeWorkspaceTrashBatchPlan(payload, request),
			).toThrowError(expect.objectContaining(contractError));
		}
	});

	it.each([
		[{ status: "trashed" }],
		[{ status: "entryRetained", reason: "entryChanged" }],
		[{ status: "entryRetained", reason: "trashFailed" }],
		[{ status: "outcomeUnknown" }],
	] as const)("decodes and freezes strict Trash result %j", (payload) => {
		const result = decodeWorkspaceTrashResult(payload);
		expect(result).toEqual(payload);
		expect(Object.isFrozen(result)).toBe(true);
	});

	it("rejects permanent-delete and malformed Trash results", () => {
		for (const payload of [
			{ status: "deleted" },
			{ status: "trashed", reason: "trashFailed" },
			{ status: "entryRetained", reason: "deleteFailed" },
			{ status: "outcomeUnknown", removedEntries: 1 },
			new Proxy({ status: "trashed" }, {}),
			Object.assign(new (class Result {})(), { status: "trashed" }),
		]) {
			expect(() => decodeWorkspaceTrashResult(payload)).toThrowError(
				expect.objectContaining(contractError),
			);
		}
	});
});
