import { describe, expect, it, vi } from "vitest";

import type {
	GitLogGraphResult,
	GitRefsListResult,
} from "../../app/platform/tauri/contracts";
import {
	DEFAULT_GRAPH_MAX_COUNT,
	PlainGitGraphController,
	type PlainGitGraphBridge,
} from "../../app/features/scm/plain-git-graph";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function graphResult(
	overrides: Partial<GitLogGraphResult> = {},
): GitLogGraphResult {
	return {
		nodes: [
			{ sha: SHA_A, parents: [SHA_B], subject: "second" },
			{ sha: SHA_B, parents: [], subject: "first" },
		],
		truncated: false,
		...overrides,
	};
}

function refsResult(
	overrides: Partial<GitRefsListResult> = {},
): GitRefsListResult {
	return {
		entries: [
			{
				kind: "branch",
				fullName: "refs/heads/main",
				shortName: "main",
				targetSha: SHA_A,
				isAnnotatedTag: false,
				peeledSha: null,
				upstream: null,
				isHead: true,
			},
		],
		truncated: false,
		...overrides,
	};
}

function fakeBridge(
	overrides: Partial<PlainGitGraphBridge> = {},
): PlainGitGraphBridge {
	return {
		gitLogGraph: vi.fn().mockResolvedValue(graphResult()),
		gitRefsList: vi.fn().mockResolvedValue(refsResult()),
		...overrides,
	};
}

describe("PlainGitGraphController", () => {
	it("starts with empty graph/refs before any refresh", () => {
		const controller = new PlainGitGraphController(fakeBridge());
		expect(controller.graph).toEqual({ nodes: [], truncated: false });
		expect(controller.refs).toEqual({ entries: [], truncated: false });
		expect(controller.layout.nodes).toEqual([]);
		expect(controller.groupedRefs.branches).toEqual([]);
		expect(controller.refBadgesBySha.size).toBe(0);
	});

	it("refresh() fetches both graph and refs and exposes them", async () => {
		const bridge = fakeBridge();
		const controller = new PlainGitGraphController(bridge);
		await controller.refresh();
		expect(bridge.gitLogGraph).toHaveBeenCalledWith(DEFAULT_GRAPH_MAX_COUNT);
		expect(bridge.gitRefsList).toHaveBeenCalledWith();
		expect(controller.graph.nodes).toHaveLength(2);
		expect(controller.refs.entries).toHaveLength(1);
	});

	it("refresh(maxCount) forwards a caller-supplied window size", async () => {
		const bridge = fakeBridge();
		const controller = new PlainGitGraphController(bridge);
		await controller.refresh(42);
		expect(bridge.gitLogGraph).toHaveBeenCalledWith(42);
	});

	it("layout reflects the fetched graph's own DAG structure", async () => {
		const controller = new PlainGitGraphController(fakeBridge());
		await controller.refresh();
		expect(controller.layout.nodes.map((node) => node.sha)).toEqual([
			SHA_A,
			SHA_B,
		]);
		expect(controller.layout.laneCount).toBe(1);
	});

	it("refBadgesBySha joins the fetched refs against the fetched graph's own node shas", async () => {
		const controller = new PlainGitGraphController(fakeBridge());
		await controller.refresh();
		expect(controller.refBadgesBySha.get(SHA_A)).toEqual([
			{ label: "main", kind: "branch", isHead: true },
		]);
		expect(controller.refBadgesBySha.has(SHA_B)).toBe(false);
	});

	it("groupedRefs splits the fetched refs by kind", async () => {
		const controller = new PlainGitGraphController(
			fakeBridge({
				gitRefsList: vi.fn().mockResolvedValue(
					refsResult({
						entries: [
							{
								kind: "tag",
								fullName: "refs/tags/v1",
								shortName: "v1",
								targetSha: SHA_A,
								isAnnotatedTag: false,
								peeledSha: null,
								upstream: null,
								isHead: false,
							},
						],
					}),
				),
			}),
		);
		await controller.refresh();
		expect(controller.groupedRefs.tags.map((entry) => entry.shortName)).toEqual(
			["v1"],
		);
		expect(controller.groupedRefs.branches).toEqual([]);
	});
});
