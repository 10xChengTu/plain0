import { describe, expect, it, vi } from "vitest";

import type { DebugVariable } from "../../app/platform/tauri/contracts";
import {
	DebugVariablesTree,
	VARIABLES_PAGE_SIZE,
	declaredCount,
	type VariablesFetcher,
} from "../../app/features/debug/plain-debug-variables-tree";

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

/** A fake `VariablesFetcher` backed by an in-memory `reference -> full
 * children array` map, sliced by `start`/`count` exactly like the real
 * bridge (and `tests/browser/workspace.spec.ts`'s own mock) would — plus a
 * call log so a test can assert exactly which `start`/`count` pairs were
 * requested. */
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

describe("declaredCount", () => {
	it("prefers indexedVariables over namedVariables when both are set", () => {
		expect(declaredCount({ indexedVariables: 5, namedVariables: 3 })).toBe(5);
	});

	it("falls back to namedVariables when indexedVariables is null", () => {
		expect(declaredCount({ indexedVariables: null, namedVariables: 3 })).toBe(
			3,
		);
	});

	it("is null when the adapter reported neither", () => {
		expect(
			declaredCount({ indexedVariables: null, namedVariables: null }),
		).toBeNull();
	});
});

describe("DebugVariablesTree", () => {
	it("starts every reference collapsed", () => {
		const { fetch } = fakeFetcher({});
		const tree = new DebugVariablesTree(fetch);
		expect(tree.isExpanded(100)).toBe(false);
		expect(tree.node(100)).toBeUndefined();
	});

	it("expand fetches exactly one first page and records the given total", async () => {
		const { fetch, calls } = fakeFetcher({
			100: [variable("a"), variable("b")],
		});
		const tree = new DebugVariablesTree(fetch);
		const changed = await tree.expand(100, 2);
		expect(changed).toBe(true);
		expect(tree.isExpanded(100)).toBe(true);
		expect(tree.node(100)).toEqual({
			variables: [variable("a"), variable("b")],
			total: 2,
		});
		expect(calls).toEqual([
			{ reference: 100, start: 0, count: VARIABLES_PAGE_SIZE },
		]);
	});

	it("expand leaves state untouched and reports failure when the fetch rejects", async () => {
		const fetch: VariablesFetcher = async () => {
			throw new Error("boom");
		};
		const tree = new DebugVariablesTree(fetch);
		const changed = await tree.expand(100, 2);
		expect(changed).toBe(false);
		expect(tree.isExpanded(100)).toBe(false);
	});

	it("toggle expands a collapsed reference and collapses an expanded one", async () => {
		const { fetch } = fakeFetcher({ 100: [variable("a")] });
		const tree = new DebugVariablesTree(fetch);

		expect(await tree.toggle(100, 1)).toBe(true);
		expect(tree.isExpanded(100)).toBe(true);

		expect(await tree.toggle(100, 1)).toBe(true);
		expect(tree.isExpanded(100)).toBe(false);
		expect(tree.node(100)).toBeUndefined();
	});

	it("toggle reports no change when the expand attempt fails", async () => {
		const fetch: VariablesFetcher = async () => {
			throw new Error("boom");
		};
		const tree = new DebugVariablesTree(fetch);
		expect(await tree.toggle(100, null)).toBe(false);
		expect(tree.isExpanded(100)).toBe(false);
	});

	it("loadMore fetches the next page starting after what is already loaded", async () => {
		const big = Array.from({ length: 150 }, (_unused, index) =>
			variable(`item_${index}`),
		);
		const { fetch, calls } = fakeFetcher({ 300: big });
		const tree = new DebugVariablesTree(fetch);
		await tree.expand(300, 150);
		expect(tree.node(300)?.variables).toHaveLength(100);

		const changed = await tree.loadMore(300);
		expect(changed).toBe(true);
		expect(tree.node(300)?.variables).toHaveLength(150);
		expect(calls).toEqual([
			{ reference: 300, start: 0, count: VARIABLES_PAGE_SIZE },
			{ reference: 300, start: 100, count: VARIABLES_PAGE_SIZE },
		]);
	});

	it("loadMore is a no-op on a reference that is not currently expanded", async () => {
		const fetchSpy = vi.fn(async () => ({ variables: [] }));
		const tree = new DebugVariablesTree(fetchSpy);
		expect(await tree.loadMore(100)).toBe(false);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("collapse drops just the given reference's own recorded page", async () => {
		const { fetch } = fakeFetcher({
			100: [variable("a")],
			200: [variable("b")],
		});
		const tree = new DebugVariablesTree(fetch);
		await tree.expand(100, 1);
		await tree.expand(200, 1);

		tree.collapse(100);
		expect(tree.isExpanded(100)).toBe(false);
		expect(tree.isExpanded(200)).toBe(true);
	});

	it("clear drops every recorded reference", async () => {
		const { fetch } = fakeFetcher({
			100: [variable("a")],
			200: [variable("b")],
		});
		const tree = new DebugVariablesTree(fetch);
		await tree.expand(100, 1);
		await tree.expand(200, 1);

		tree.clear();
		expect(tree.isExpanded(100)).toBe(false);
		expect(tree.isExpanded(200)).toBe(false);
	});
});
