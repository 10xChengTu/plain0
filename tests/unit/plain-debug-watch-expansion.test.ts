import { describe, expect, it } from "vitest";

import type { DebugVariable } from "../../app/platform/tauri/contracts";
import {
	DebugVariablesTree,
	type VariablesFetcher,
} from "../../app/features/debug/plain-debug-variables-tree";
import {
	collectExpandedPaths,
	pruneExpandedSubtree,
	restoreExpandedPaths,
} from "../../app/features/debug/plain-debug-watch-expansion";

function variable(
	name: string,
	overrides: Partial<DebugVariable> = {},
): DebugVariable {
	return {
		name,
		value: name,
		type: null,
		variablesReference: 0,
		namedVariables: null,
		indexedVariables: null,
		...overrides,
	};
}

function fakeFetcher(
	byReference: Readonly<Record<number, readonly DebugVariable[]>>,
): {
	fetch: VariablesFetcher;
	calls: Array<{ reference: number; start: number; count: number }>;
} {
	const calls: Array<{ reference: number; start: number; count: number }> = [];
	const fetch: VariablesFetcher = async (reference, start, count) => {
		calls.push({ reference, start, count });
		const all = byReference[reference] ?? [];
		return { variables: all.slice(start, start + count) };
	};
	return { fetch, calls };
}

describe("collectExpandedPaths", () => {
	it("records the root path and every expanded descendant's own name path", async () => {
		const { fetch } = fakeFetcher({
			100: [variable("a"), variable("obj", { variablesReference: 200 })],
			200: [variable("x"), variable("y")],
		});
		const tree = new DebugVariablesTree(fetch);
		await tree.expand(100, 2);
		await tree.expand(200, 2);

		const out = new Set<string>();
		collectExpandedPaths(tree, 100, [], out);
		expect(out).toEqual(new Set([JSON.stringify([]), JSON.stringify(["obj"])]));
	});

	it("does not descend into a node that is not itself expanded", async () => {
		const { fetch } = fakeFetcher({
			100: [variable("obj", { variablesReference: 200 })],
			200: [variable("x")],
		});
		const tree = new DebugVariablesTree(fetch);
		await tree.expand(100, 1);
		// 200 ("obj") is deliberately left collapsed.

		const out = new Set<string>();
		collectExpandedPaths(tree, 100, [], out);
		expect(out).toEqual(new Set([JSON.stringify([])]));
	});

	it("is a no-op for a leaf reference (0)", () => {
		const tree = new DebugVariablesTree(async () => ({ variables: [] }));
		const out = new Set<string>();
		collectExpandedPaths(tree, 0, [], out);
		expect(out.size).toBe(0);
	});
});

describe("pruneExpandedSubtree", () => {
	it("drops the given reference and every currently-expanded descendant", async () => {
		const { fetch } = fakeFetcher({
			100: [variable("obj", { variablesReference: 200 })],
			200: [variable("x")],
		});
		const tree = new DebugVariablesTree(fetch);
		await tree.expand(100, 1);
		await tree.expand(200, 1);

		pruneExpandedSubtree(tree, 100);
		expect(tree.isExpanded(100)).toBe(false);
		expect(tree.isExpanded(200)).toBe(false);
	});

	it("leaves an unrelated reference's own recorded state untouched", async () => {
		const { fetch } = fakeFetcher({
			100: [variable("a")],
			999: [variable("z")],
		});
		const tree = new DebugVariablesTree(fetch);
		await tree.expand(100, 1);
		await tree.expand(999, 1);

		pruneExpandedSubtree(tree, 100);
		expect(tree.isExpanded(999)).toBe(true);
	});
});

describe("restoreExpandedPaths", () => {
	it("re-expands the root and every still-expanded descendant under a brand-new set of reference numbers", async () => {
		// The "old" tree (before a re-evaluate) — root ref 100, one expanded
		// nested object "obj" at ref 200.
		const oldFetcher = fakeFetcher({
			100: [variable("a"), variable("obj", { variablesReference: 200 })],
			200: [variable("x"), variable("y")],
		});
		const oldTree = new DebugVariablesTree(oldFetcher.fetch);
		await oldTree.expand(100, 2);
		await oldTree.expand(200, 2);
		const expandedPaths = new Set<string>();
		collectExpandedPaths(oldTree, 100, [], expandedPaths);

		// The "new" tree (after a re-evaluate) — same names, but the adapter
		// minted entirely different reference numbers this time, exactly as a
		// real adapter is free to do.
		const newFetcher = fakeFetcher({
			999: [variable("a"), variable("obj", { variablesReference: 888 })],
			888: [variable("x"), variable("y")],
		});
		const newTree = new DebugVariablesTree(newFetcher.fetch);

		await restoreExpandedPaths(newTree, 999, 2, [], expandedPaths);

		expect(newTree.isExpanded(999)).toBe(true);
		expect(newTree.isExpanded(888)).toBe(true);
		expect(newTree.node(888)?.variables.map((v) => v.name)).toEqual(["x", "y"]);
	});

	it("does nothing for a reference whose own path was never expanded", async () => {
		const { fetch, calls } = fakeFetcher({
			999: [variable("a")],
		});
		const tree = new DebugVariablesTree(fetch);

		await restoreExpandedPaths(tree, 999, 1, [], new Set());

		expect(tree.isExpanded(999)).toBe(false);
		expect(calls).toHaveLength(0);
	});

	it("silently leaves a renamed-away path collapsed instead of failing", async () => {
		const oldFetcher = fakeFetcher({
			100: [variable("obj", { variablesReference: 200 })],
			200: [variable("x")],
		});
		const oldTree = new DebugVariablesTree(oldFetcher.fetch);
		await oldTree.expand(100, 1);
		await oldTree.expand(200, 1);
		const expandedPaths = new Set<string>();
		collectExpandedPaths(oldTree, 100, [], expandedPaths);
		expect(expandedPaths.has(JSON.stringify(["obj"]))).toBe(true);

		// The re-evaluated value no longer has a variable named "obj" at all.
		const newFetcher = fakeFetcher({
			999: [variable("renamed", { variablesReference: 888 })],
		});
		const newTree = new DebugVariablesTree(newFetcher.fetch);

		await restoreExpandedPaths(newTree, 999, 1, [], expandedPaths);

		expect(newTree.isExpanded(999)).toBe(true);
		expect(newTree.isExpanded(888)).toBe(false);
	});

	it("pages through further children when a still-expanded descendant's name is beyond the first page", async () => {
		// 150 children; the 121st ("deep", 0-indexed 120) is itself expanded.
		const oldChildren = Array.from({ length: 150 }, (_unused, index) =>
			index === 120
				? variable("deep", { variablesReference: 300 })
				: variable(`item_${index}`),
		);
		const oldFetcher = fakeFetcher({
			100: oldChildren,
			300: [variable("value")],
		});
		const oldTree = new DebugVariablesTree(oldFetcher.fetch);
		await oldTree.expand(100, 150);
		await oldTree.loadMore(100); // now 150 loaded, including "deep"
		await oldTree.expand(300, 1);
		const expandedPaths = new Set<string>();
		collectExpandedPaths(oldTree, 100, [], expandedPaths);
		expect(expandedPaths).toEqual(
			new Set([JSON.stringify([]), JSON.stringify(["deep"])]),
		);

		// Same 150-item shape after the re-evaluate, under new reference
		// numbers.
		const newChildren = Array.from({ length: 150 }, (_unused, index) =>
			index === 120
				? variable("deep", { variablesReference: 777 })
				: variable(`item_${index}`),
		);
		const newFetcher = fakeFetcher({
			999: newChildren,
			777: [variable("value")],
		});
		const newTree = new DebugVariablesTree(newFetcher.fetch);

		await restoreExpandedPaths(newTree, 999, 150, [], expandedPaths);

		expect(newTree.node(999)?.variables).toHaveLength(150);
		expect(newTree.isExpanded(777)).toBe(true);
		// The root was paged twice (0-100, then 100-100) to reach "deep".
		expect(newFetcher.calls.filter((call) => call.reference === 999)).toEqual([
			{ reference: 999, start: 0, count: 100 },
			{ reference: 999, start: 100, count: 100 },
		]);
	});
});
