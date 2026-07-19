import { describe, expect, it, vi } from "vitest";

import {
	decodeWorkspaceWatchSyncResult,
	decodeWorkspaceWatchWakeEvent,
	frozenWorkspaceWatchSyncRequest,
} from "../../app/platform/tauri/workspace-codec";

const rootA = "00000000-0000-4000-8000-000000000101";
const rootB = "00000000-0000-4000-8000-000000000102";
const workspaceId = "00000000-0000-4000-8000-000000000001";

function expectCode(operation: () => unknown, code: string): void {
	expect(operation).toThrowError(expect.objectContaining({ code }));
}

describe("workspace watcher codec", () => {
	it("snapshots one to 256 unique roots with explicit nullable acknowledgements", () => {
		const roots = [
			{ rootId: rootA, acknowledgedGeneration: null },
			{ rootId: rootB, acknowledgedGeneration: 7 },
		];
		const request = frozenWorkspaceWatchSyncRequest(roots);
		expect(request).toEqual({ roots });
		expect(Object.isFrozen(request)).toBe(true);
		expect(Object.isFrozen(request.roots)).toBe(true);
		expect(request.roots.every(Object.isFrozen)).toBe(true);
		roots[0]!.rootId = rootB;
		expect(request.roots[0]!.rootId).toBe(rootA);

		for (const invalid of [
			[],
			[{ rootId: rootA }],
			[{ rootId: rootA, acknowledgedGeneration: 0 }],
			[{ rootId: rootA, acknowledgedGeneration: 0x1_0000_0000 }],
			[{ rootId: rootA, acknowledgedGeneration: 1, relativePath: "src" }],
			[
				{ rootId: rootA, acknowledgedGeneration: null },
				{ rootId: rootA, acknowledgedGeneration: 1 },
			],
		]) {
			expectCode(
				() => frozenWorkspaceWatchSyncRequest(invalid),
				"WORKSPACE_WATCH_REQUEST_INVALID",
			);
		}

		expectCode(
			() =>
				frozenWorkspaceWatchSyncRequest(
					Array.from({ length: 257 }, (_, index) => ({
						rootId: `00000000-0000-4000-8000-${index
							.toString()
							.padStart(12, "0")}`,
						acknowledgedGeneration: null,
					})),
				),
			"WORKSPACE_WATCH_REQUEST_INVALID",
		);
	});

	it("rejects accessors and proxies before a watch request can change shape", () => {
		const getter = vi.fn(() => rootA);
		const entry = Object.defineProperty(
			{ acknowledgedGeneration: null },
			"rootId",
			{ enumerable: true, get: getter },
		);
		expectCode(
			() => frozenWorkspaceWatchSyncRequest([entry]),
			"WORKSPACE_WATCH_REQUEST_INVALID",
		);
		expect(getter).not.toHaveBeenCalled();

		const ownKeys = vi.fn(() => ["0", "length"]);
		const proxy = new Proxy([{ rootId: rootA, acknowledgedGeneration: null }], {
			ownKeys,
		});
		expectCode(
			() => frozenWorkspaceWatchSyncRequest(proxy),
			"WORKSPACE_WATCH_REQUEST_INVALID",
		);
		expect(ownKeys).toHaveBeenCalledTimes(1);
	});

	it("decodes only one path-free wake payload", () => {
		const wake = decodeWorkspaceWatchWakeEvent({ workspaceId });
		expect(wake).toEqual({ workspaceId });
		expect(Object.isFrozen(wake)).toBe(true);
		for (const invalid of [
			{},
			{ workspaceId: rootA, rootId: rootA },
			{ workspaceId: "not-a-uuid" },
			{ workspaceId, path: "/Users/private" },
		]) {
			expectCode(
				() => decodeWorkspaceWatchWakeEvent(invalid),
				"IPC_CONTRACT_VIOLATION",
			);
		}
	});

	it("binds pending generations to the exact request and freezes the result", () => {
		const request = frozenWorkspaceWatchSyncRequest([
			{ rootId: rootA, acknowledgedGeneration: null },
			{ rootId: rootB, acknowledgedGeneration: 4 },
		]);
		const result = decodeWorkspaceWatchSyncResult(
			{
				workspaceId,
				roots: [
					{ rootId: rootA, generation: 1, rescanRequired: false },
					{ rootId: rootB, generation: 5, rescanRequired: true },
				],
			},
			request,
		);
		expect(result).toEqual({
			workspaceId,
			roots: [
				{ rootId: rootA, generation: 1, rescanRequired: false },
				{ rootId: rootB, generation: 5, rescanRequired: true },
			],
		});
		expect(Object.isFrozen(result)).toBe(true);
		expect(Object.isFrozen(result.roots)).toBe(true);
		expect(result.roots.every(Object.isFrozen)).toBe(true);

		const saturatedRequest = frozenWorkspaceWatchSyncRequest([
			{ rootId: rootA, acknowledgedGeneration: 0xffff_ffff },
		]);
		expect(
			decodeWorkspaceWatchSyncResult(
				{
					workspaceId,
					roots: [
						{
							rootId: rootA,
							generation: 0xffff_ffff,
							rescanRequired: true,
						},
					],
				},
				saturatedRequest,
			),
		).toEqual({
			workspaceId,
			roots: [
				{
					rootId: rootA,
					generation: 0xffff_ffff,
					rescanRequired: true,
				},
			],
		});
		expectCode(
			() =>
				decodeWorkspaceWatchSyncResult(
					{
						workspaceId,
						roots: [
							{
								rootId: rootA,
								generation: 0xffff_ffff,
								rescanRequired: false,
							},
						],
					},
					saturatedRequest,
				),
			"IPC_CONTRACT_VIOLATION",
		);

		for (const invalid of [
			{
				workspaceId,
				roots: [{ rootId: rootB, generation: 4, rescanRequired: true }],
			},
			{
				workspaceId,
				roots: [{ rootId: rootA, generation: 0, rescanRequired: true }],
			},
			{
				workspaceId,
				roots: [{ rootId: rootA, generation: 1, rescanRequired: 1 }],
			},
			{
				workspaceId,
				roots: [
					{ rootId: rootA, generation: 1, rescanRequired: true, path: "src" },
				],
			},
			{
				workspaceId,
				roots: [
					{
						rootId: "00000000-0000-4000-8000-000000000103",
						generation: 1,
						rescanRequired: true,
					},
				],
			},
			{
				workspaceId,
				roots: [
					{ rootId: rootA, generation: 1, rescanRequired: true },
					{ rootId: rootA, generation: 2, rescanRequired: true },
				],
			},
			{ workspaceId, roots: [], canonicalPath: "/private" },
		]) {
			expectCode(
				() => decodeWorkspaceWatchSyncResult(invalid, request),
				"IPC_CONTRACT_VIOLATION",
			);
		}
	});
});
