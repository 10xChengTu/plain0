import { describe, expect, it } from "vitest";

import {
	decodeWorkspaceDeleteBatchPlan,
	decodeWorkspaceDeleteResult,
	frozenWorkspaceCommitDeleteEntryRequest,
	frozenWorkspaceDeleteBatchRequest,
	frozenWorkspacePrepareDeleteRequest,
} from "../../app/platform/tauri/workspace-codec";

const rootId = "00000000-0000-4000-8000-000000000101";
const secondRootId = "00000000-0000-4000-8000-000000000102";
const confirmationId = "10000000-0000-4000-8000-000000000001";
const entryId = "10000000-0000-4000-8000-000000000002";
const contractError = { code: "IPC_CONTRACT_VIOLATION" };
const invalidPlan = { code: "WORKSPACE_DELETE_PLAN_INVALID" };

describe("workspace delete codec", () => {
	it("builds a deeply frozen bounded prepare request", () => {
		const input = [
			{ rootId, relativePath: "README.md", recursive: false },
			{ rootId: secondRootId, relativePath: "src", recursive: true },
		];
		const request = frozenWorkspacePrepareDeleteRequest(input);

		expect(request).toEqual({ entries: input });
		expect(request.entries).not.toBe(input);
		expect(Object.isFrozen(request)).toBe(true);
		expect(Object.isFrozen(request.entries)).toBe(true);
		expect(request.entries.every(Object.isFrozen)).toBe(true);
		input[0]!.relativePath = "changed";
		expect(request.entries[0]!.relativePath).toBe("README.md");

		const maximum = frozenWorkspacePrepareDeleteRequest(
			Array.from({ length: 64 }, (_, index) => ({
				rootId,
				relativePath: `entry-${index}`,
				recursive: false,
			})),
		);
		expect(maximum.entries).toHaveLength(64);
	});

	it("rejects empty, oversized, overlapping, malformed, accessor and Proxy requests", () => {
		for (const [input, code] of [
			[[], "WORKSPACE_CONFLICT"],
			[
				Array.from({ length: 65 }, (_, index) => ({
					rootId,
					relativePath: `entry-${index}`,
					recursive: false,
				})),
				"WORKSPACE_CONFLICT",
			],
			[[{ rootId, relativePath: "", recursive: false }], "ENTRY_TYPE_MISMATCH"],
			[
				[{ rootId, relativePath: "README.md", recursive: "yes" }],
				"WORKSPACE_DELETE_PLAN_INVALID",
			],
			[
				[
					{
						rootId,
						relativePath: "README.md",
						recursive: false,
						path: "/tmp",
					},
				],
				"WORKSPACE_DELETE_PLAN_INVALID",
			],
			[
				[
					{ rootId, relativePath: "src", recursive: true },
					{ rootId, relativePath: "src/main.ts", recursive: false },
				],
				"WORKSPACE_CONFLICT",
			],
			[
				[
					{ rootId, relativePath: "README.md", recursive: false },
					{ rootId, relativePath: "README.md", recursive: true },
				],
				"WORKSPACE_CONFLICT",
			],
		] as const) {
			expect(() => frozenWorkspacePrepareDeleteRequest(input)).toThrowError(
				expect.objectContaining({ code }),
			);
		}

		let accessorReads = 0;
		const accessor = Object.defineProperty(
			{ rootId, relativePath: "README.md" },
			"recursive",
			{
				enumerable: true,
				get() {
					accessorReads += 1;
					return false;
				},
			},
		);
		expect(() => frozenWorkspacePrepareDeleteRequest([accessor])).toThrowError(
			expect.objectContaining(invalidPlan),
		);
		expect(accessorReads).toBe(0);

		const proxyEntry = new Proxy(
			{ rootId, relativePath: "README.md", recursive: false },
			{},
		);
		const proxyArray = new Proxy(
			[{ rootId, relativePath: "README.md", recursive: false }],
			{},
		);
		for (const input of [[proxyEntry], proxyArray]) {
			expect(() => frozenWorkspacePrepareDeleteRequest(input)).toThrowError(
				expect.objectContaining(invalidPlan),
			);
		}
	});

	it("builds strict batch and commit requests", () => {
		expect(frozenWorkspaceDeleteBatchRequest(confirmationId)).toEqual({
			confirmationId,
		});
		const commit = frozenWorkspaceCommitDeleteEntryRequest(
			confirmationId,
			entryId,
			rootId,
			"src",
			true,
		);
		expect(commit).toEqual({
			confirmationId,
			entryId,
			rootId,
			relativePath: "src",
			recursive: true,
		});
		expect(Object.isFrozen(commit)).toBe(true);
		for (const operation of [
			() => frozenWorkspaceDeleteBatchRequest("not-a-token"),
			() =>
				frozenWorkspaceCommitDeleteEntryRequest(
					confirmationId,
					confirmationId,
					rootId,
					"src",
					true,
				),
		]) {
			expect(operation).toThrowError(expect.objectContaining(invalidPlan));
		}
		expect(() =>
			frozenWorkspaceCommitDeleteEntryRequest(
				confirmationId,
				entryId,
				rootId,
				"",
				false,
			),
		).toThrowError(expect.objectContaining({ code: "ENTRY_TYPE_MISMATCH" }));
	});

	it("decodes only a length-bound, unique and deeply frozen plan", () => {
		const request = frozenWorkspacePrepareDeleteRequest([
			{ rootId, relativePath: "README.md", recursive: false },
			{ rootId, relativePath: "src", recursive: true },
		]);
		const plan = decodeWorkspaceDeleteBatchPlan(
			{
				confirmationId,
				entries: [
					{ entryId, kind: "file", descendantEntries: 0 },
					{
						entryId: "10000000-0000-4000-8000-000000000003",
						kind: "directory",
						descendantEntries: 10_000,
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
					{ entryId, kind: "file", descendantEntries: 0 },
					{ entryId, kind: "directory", descendantEntries: 0 },
				],
			},
			{
				confirmationId,
				entries: [
					{ entryId, kind: "file", descendantEntries: 1 },
					{
						entryId: "10000000-0000-4000-8000-000000000003",
						kind: "directory",
						descendantEntries: 0,
					},
				],
			},
			{
				confirmationId,
				entries: [
					{ entryId, kind: "file", descendantEntries: 0 },
					{
						entryId: "10000000-0000-4000-8000-000000000003",
						kind: "directory",
						descendantEntries: 10_001,
					},
				],
			},
			{
				confirmationId,
				entries: [
					{ entryId, kind: "file", descendantEntries: 0 },
					{
						entryId: "10000000-0000-4000-8000-000000000003",
						kind: "directory",
						descendantEntries: 1.5,
					},
				],
			},
		]) {
			expect(() =>
				decodeWorkspaceDeleteBatchPlan(payload, request),
			).toThrowError(expect.objectContaining(contractError));
		}
	});

	it("rejects plan accessors, proxies, symbols, prototypes and post-snapshot tricks", () => {
		const request = frozenWorkspacePrepareDeleteRequest([
			{ rootId, relativePath: "README.md", recursive: false },
		]);
		let reads = 0;
		const accessorEntry = Object.defineProperty(
			{ entryId, kind: "file" },
			"descendantEntries",
			{
				enumerable: true,
				get() {
					reads += 1;
					return 0;
				},
			},
		);
		const classPlan = Object.assign(new (class Plan {})(), {
			confirmationId,
			entries: [{ entryId, kind: "file", descendantEntries: 0 }],
		});
		for (const payload of [
			{ confirmationId, entries: [accessorEntry] },
			new Proxy(
				{
					confirmationId,
					entries: [{ entryId, kind: "file", descendantEntries: 0 }],
				},
				{},
			),
			{
				confirmationId,
				entries: [
					new Proxy({ entryId, kind: "file", descendantEntries: 0 }, {}),
				],
			},
			{
				confirmationId,
				entries: [{ entryId, kind: "file", descendantEntries: 0 }],
				[Symbol("private")]: true,
			},
			classPlan,
		]) {
			expect(() =>
				decodeWorkspaceDeleteBatchPlan(payload, request),
			).toThrowError(expect.objectContaining(contractError));
		}
		expect(reads).toBe(0);
	});

	it.each([
		[{ status: "deleted" }],
		[{ status: "entryRetained", reason: "entryChanged" }],
		[
			{
				status: "entryPartiallyDeleted",
				reason: "entryUnverifiable",
				removedEntries: 10_000,
			},
		],
	] as const)("decodes and freezes strict result %j", (payload) => {
		const result = decodeWorkspaceDeleteResult(payload);
		expect(result).toEqual(payload);
		expect(Object.isFrozen(result)).toBe(true);
	});

	it("rejects malformed delete results", () => {
		for (const payload of [
			{ status: "deleted", reason: "entryChanged" },
			{ status: "entryRetained", reason: "unknown" },
			{
				status: "entryPartiallyDeleted",
				reason: "deleteFailed",
				removedEntries: 0,
			},
			{
				status: "entryPartiallyDeleted",
				reason: "deleteFailed",
				removedEntries: 10_001,
			},
			new Proxy({ status: "deleted" }, {}),
			Object.assign(new (class Result {})(), { status: "deleted" }),
		]) {
			expect(() => decodeWorkspaceDeleteResult(payload)).toThrowError(
				expect.objectContaining(contractError),
			);
		}
	});
});
