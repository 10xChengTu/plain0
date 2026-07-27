import { describe, expect, it } from "vitest";

import type { GitGraphNode } from "../../app/platform/tauri/contracts";
import {
	computeGraphLayout,
	graphLaneColor,
	GRAPH_LANE_COLORS,
} from "../../app/features/scm/plain-git-graph-layout";

function node(
	sha: string,
	parents: readonly string[],
	subject = sha,
): GitGraphNode {
	return { sha, parents, subject };
}

describe("computeGraphLayout", () => {
	it("keeps a linear chain entirely in lane 0", () => {
		const nodes = [node("c3", ["c2"]), node("c2", ["c1"]), node("c1", [])];
		const result = computeGraphLayout(nodes);
		expect(result.laneCount).toBe(1);
		for (const laidOut of result.nodes) {
			expect(laidOut.lane).toBe(0);
			expect(laidOut.color).toBe(0);
		}
		expect(result.nodes[0]?.parentLanes).toEqual([0]);
		expect(result.nodes[2]?.parentLanes).toEqual([]);
	});

	it("lays out an ordinary two-parent merge: main-line lane continues through the merge, the merged branch gets its own lane and reconverges at the shared ancestor", () => {
		// Topo-order, newest first: the merge M, then its second parent P2's
		// own branch tip, then its first parent P1, then the shared root R.
		const nodes = [
			node("M", ["P1", "P2"]),
			node("P2", ["R"]),
			node("P1", ["R"]),
			node("R", []),
		];
		const result = computeGraphLayout(nodes);

		const bySha = new Map(result.nodes.map((entry) => [entry.sha, entry]));
		const m = bySha.get("M");
		expect(m?.lane).toBe(0);
		expect(m?.parentLanes).toEqual([0, 1]);

		const p2 = bySha.get("P2");
		expect(p2?.lane).toBe(1);
		expect(p2?.parentLanes).toEqual([1]);

		const p1 = bySha.get("P1");
		expect(p1?.lane).toBe(0);
		expect(p1?.parentLanes).toEqual([0]);

		const r = bySha.get("R");
		// Both the main-line lane (0, continuing from P1) and the merged
		// branch's lane (1, continuing from P2) are waiting for R at this
		// point — they converge onto the first (leftmost), lane 0.
		expect(r?.lane).toBe(0);
		expect(r?.parents).toEqual([]);
		expect(r?.parentLanes).toEqual([]);

		expect(result.laneCount).toBe(2);
	});

	it("lays out a real octopus merge (4 parents) with each extra parent opening its own lane, all reconverging at the shared root", () => {
		// Mirrors this feature's own real git fixture
		// (`log_graph_topo_orders_a_multi_branch_merge_dag_including_an_octopus_merge`
		// in `src-tauri/src/git/log/tests.rs`): a merge of 3 branches into
		// main, in the exact topo-order real git reported for that fixture.
		const nodes = [
			node("merge", ["mainTip", "aTip", "bTip", "cTip"]),
			node("cTip", ["root"]),
			node("bTip", ["root"]),
			node("aTip", ["root"]),
			node("mainTip", ["root"]),
			node("root", []),
		];
		const result = computeGraphLayout(nodes);
		const bySha = new Map(result.nodes.map((entry) => [entry.sha, entry]));

		const merge = bySha.get("merge");
		expect(merge?.lane).toBe(0);
		expect(merge?.parentLanes).toEqual([0, 1, 2, 3]);

		expect(bySha.get("cTip")?.lane).toBe(3);
		expect(bySha.get("bTip")?.lane).toBe(2);
		expect(bySha.get("aTip")?.lane).toBe(1);
		expect(bySha.get("mainTip")?.lane).toBe(0);

		const root = bySha.get("root");
		expect(root?.parentLanes).toEqual([]);

		// Four concurrently active lanes at the octopus merge's own fan-out,
		// before every one of them reconverges on the shared root commit.
		expect(result.laneCount).toBe(4);
	});

	it("lays out a root commit with two independent, not-yet-merged children forking directly off it", () => {
		// Neither `a` nor `b` is a merge commit; both simply list the same
		// commit `c` as their sole parent — two still-unmerged branch tips
		// sharing a common ancestor. Documents (and locks) this layout's own
		// disclosed simplification: `a`'s edge to `c` is drawn from lane 1
		// into lane 0 (a "crossing" line) rather than opening a dedicated
		// lane for `c` that both `a` and `b` cross into — an intentionally
		// simple, still-structurally-correct choice for a first version.
		const nodes = [node("b", ["c"]), node("a", ["c"]), node("c", [])];
		const result = computeGraphLayout(nodes);
		const bySha = new Map(result.nodes.map((entry) => [entry.sha, entry]));

		expect(bySha.get("b")?.lane).toBe(0);
		expect(bySha.get("b")?.parentLanes).toEqual([0]);
		expect(bySha.get("a")?.lane).toBe(1);
		expect(bySha.get("a")?.parentLanes).toEqual([0]);
		expect(bySha.get("c")?.lane).toBe(0);
		expect(bySha.get("c")?.parentLanes).toEqual([]);

		expect(result.laneCount).toBe(2);
	});

	it("returns an empty layout for zero nodes", () => {
		const result = computeGraphLayout([]);
		expect(result.nodes).toEqual([]);
		expect(result.laneCount).toBe(0);
	});

	it("lays out a single root commit with no parents at all", () => {
		const result = computeGraphLayout([node("only", [])]);
		expect(result.nodes).toHaveLength(1);
		expect(result.nodes[0]?.lane).toBe(0);
		expect(result.nodes[0]?.parentLanes).toEqual([]);
		expect(result.laneCount).toBe(1);
	});
});

describe("graphLaneColor", () => {
	it("cycles through the fixed palette by index", () => {
		expect(graphLaneColor(0)).toBe(GRAPH_LANE_COLORS[0]);
		expect(graphLaneColor(GRAPH_LANE_COLORS.length)).toBe(GRAPH_LANE_COLORS[0]);
	});

	it("never throws and always returns a defined color for a negative index", () => {
		expect(typeof graphLaneColor(-1)).toBe("string");
		expect(graphLaneColor(-1)).toBe(
			GRAPH_LANE_COLORS[GRAPH_LANE_COLORS.length - 1],
		);
	});
});
