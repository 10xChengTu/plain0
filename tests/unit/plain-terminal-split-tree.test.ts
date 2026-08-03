import { describe, expect, it } from "vitest";

import {
	countSplitPanes,
	createSplitLeaf,
	firstSplitPaneId,
	removeTreeLeaf,
	splitPaneIdsInOrder,
	splitTreeLeaf,
} from "../../app/features/terminal/plain-terminal-split-tree";

describe("createSplitLeaf", () => {
	it("creates a single-leaf tree holding exactly one pane", () => {
		const tree = createSplitLeaf("pane-1");

		expect(tree).toEqual({ kind: "leaf", paneId: "pane-1" });
		expect(countSplitPanes(tree)).toBe(1);
		expect(splitPaneIdsInOrder(tree)).toEqual(["pane-1"]);
		expect(firstSplitPaneId(tree)).toBe("pane-1");
	});
});

describe("splitTreeLeaf", () => {
	it("replaces a single leaf with a split of the given orientation, keeping the old leaf first", () => {
		const tree = createSplitLeaf("pane-1");

		const next = splitTreeLeaf(tree, "pane-1", "row", "pane-2");

		expect(next).toEqual({
			kind: "split",
			orientation: "row",
			first: { kind: "leaf", paneId: "pane-1" },
			second: { kind: "leaf", paneId: "pane-2" },
		});
	});

	it("counts panes and lists ids in left-to-right/pre-order after a split", () => {
		const tree = splitTreeLeaf(
			createSplitLeaf("pane-1"),
			"pane-1",
			"row",
			"pane-2",
		);
		expect(tree).not.toBeUndefined();
		if (tree === undefined) {
			return;
		}

		expect(countSplitPanes(tree)).toBe(2);
		expect(splitPaneIdsInOrder(tree)).toEqual(["pane-1", "pane-2"]);
	});

	it("splits a leaf nested arbitrarily deep, leaving every sibling untouched", () => {
		// Build: split(row){ pane-1, split(column){ pane-2, pane-3 } }
		let tree = createSplitLeaf("pane-1");
		tree = splitTreeLeaf(tree, "pane-1", "row", "pane-2") ?? tree;
		tree = splitTreeLeaf(tree, "pane-2", "column", "pane-3") ?? tree;

		// Now split pane-3 (the deepest leaf) — pane-1 and pane-2 must be
		// completely unchanged (`splitTreeLeaf` never touches any leaf other
		// than the target).
		const next = splitTreeLeaf(tree, "pane-3", "row", "pane-4");
		expect(next).not.toBeUndefined();
		if (next === undefined) {
			return;
		}

		expect(countSplitPanes(next)).toBe(4);
		expect(splitPaneIdsInOrder(next)).toEqual([
			"pane-1",
			"pane-2",
			"pane-3",
			"pane-4",
		]);
		expect(next).toEqual({
			kind: "split",
			orientation: "row",
			first: { kind: "leaf", paneId: "pane-1" },
			second: {
				kind: "split",
				orientation: "column",
				first: { kind: "leaf", paneId: "pane-2" },
				second: {
					kind: "split",
					orientation: "row",
					first: { kind: "leaf", paneId: "pane-3" },
					second: { kind: "leaf", paneId: "pane-4" },
				},
			},
		});
	});

	it("returns undefined (never a partially-built tree) for an unknown target pane id", () => {
		const tree = createSplitLeaf("pane-1");

		expect(
			splitTreeLeaf(tree, "does-not-exist", "row", "pane-2"),
		).toBeUndefined();
	});

	it("each internal node independently keeps its own orientation — splitting deeper does not change an ancestor's", () => {
		let tree = createSplitLeaf("pane-1");
		tree = splitTreeLeaf(tree, "pane-1", "row", "pane-2") ?? tree;
		tree = splitTreeLeaf(tree, "pane-2", "column", "pane-3") ?? tree;

		expect(tree.kind).toBe("split");
		if (tree.kind !== "split") {
			return;
		}
		expect(tree.orientation).toBe("row");
		expect(tree.second.kind).toBe("split");
		if (tree.second.kind !== "split") {
			return;
		}
		expect(tree.second.orientation).toBe("column");
	});
});

describe("removeTreeLeaf", () => {
	it("removing the only leaf in a tree reports the tree became empty", () => {
		const tree = createSplitLeaf("pane-1");

		expect(removeTreeLeaf(tree, "pane-1")).toEqual({ kind: "empty" });
	});

	it("removing one of two panes promotes the sibling to become the whole tree", () => {
		const tree = splitTreeLeaf(
			createSplitLeaf("pane-1"),
			"pane-1",
			"row",
			"pane-2",
		);
		expect(tree).not.toBeUndefined();
		if (tree === undefined) {
			return;
		}

		const removedFirst = removeTreeLeaf(tree, "pane-1");
		expect(removedFirst).toEqual({
			kind: "removed",
			tree: { kind: "leaf", paneId: "pane-2" },
		});

		const removedSecond = removeTreeLeaf(tree, "pane-2");
		expect(removedSecond).toEqual({
			kind: "removed",
			tree: { kind: "leaf", paneId: "pane-1" },
		});
	});

	it("removing a middle leaf promotes its sibling subtree into the parent split's place, leaving the outer split's other side untouched", () => {
		// Build: split(row){ pane-1, split(column){ pane-2, pane-3 } }
		let tree = createSplitLeaf("pane-1");
		tree = splitTreeLeaf(tree, "pane-1", "row", "pane-2") ?? tree;
		tree = splitTreeLeaf(tree, "pane-2", "column", "pane-3") ?? tree;

		// Removing pane-2 must promote pane-3 up to be the row split's direct
		// second child — pane-1 (the row split's other side) is untouched.
		const removal = removeTreeLeaf(tree, "pane-2");
		expect(removal).toEqual({
			kind: "removed",
			tree: {
				kind: "split",
				orientation: "row",
				first: { kind: "leaf", paneId: "pane-1" },
				second: { kind: "leaf", paneId: "pane-3" },
			},
		});
	});

	it("removing a deeply nested leaf only collapses its own immediate parent split, not any ancestor", () => {
		let tree = createSplitLeaf("pane-1");
		tree = splitTreeLeaf(tree, "pane-1", "column", "pane-2") ?? tree;
		// tree is now: split(column){ pane-1, pane-2 }
		tree = splitTreeLeaf(tree, "pane-1", "row", "pane-3") ?? tree;
		// Splitting pane-1 again nests it one level deeper: pane-2 (the outer
		// column split's other side) must be completely untouched by this.
		// tree is now: split(column){ split(row){pane-1,pane-3}, pane-2 }
		expect(splitPaneIdsInOrder(tree)).toEqual(["pane-1", "pane-3", "pane-2"]);

		// Removing pane-1 must only collapse its own immediate parent (the
		// inner row split), promoting pane-3 up to become the outer column
		// split's direct first child — pane-2 stays exactly where it was.
		const removal = removeTreeLeaf(tree, "pane-1");
		expect(removal).toEqual({
			kind: "removed",
			tree: {
				kind: "split",
				orientation: "column",
				first: { kind: "leaf", paneId: "pane-3" },
				second: { kind: "leaf", paneId: "pane-2" },
			},
		});
	});

	it("returns undefined for a pane id that does not exist in the tree", () => {
		const tree = splitTreeLeaf(
			createSplitLeaf("pane-1"),
			"pane-1",
			"row",
			"pane-2",
		);
		expect(tree).not.toBeUndefined();
		if (tree === undefined) {
			return;
		}

		expect(removeTreeLeaf(tree, "does-not-exist")).toBeUndefined();
	});
});

describe("firstSplitPaneId", () => {
	it("returns the leftmost/topmost leaf across a multi-level tree", () => {
		let tree = createSplitLeaf("pane-1");
		tree = splitTreeLeaf(tree, "pane-1", "row", "pane-2") ?? tree;
		tree = splitTreeLeaf(tree, "pane-2", "column", "pane-3") ?? tree;

		expect(firstSplitPaneId(tree)).toBe("pane-1");
	});
});
