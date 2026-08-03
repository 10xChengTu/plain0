/**
 * `F190` S3 "recursive split tree": a pure, immutable binary tree describing
 * one tab's pane layout. Deliberately DOM/IPC-free at the type level — like
 * `plain-terminal-scroll.ts`/`plain-terminal-defaults.ts` — so it is fully
 * unit-testable in this repo's Node-only Vitest environment; `TerminalTabsModel`
 * is the only thing that owns a mutable `tree` field per tab, and
 * `PlainTerminalView` is the only thing that ever turns a snapshot of that
 * tree into real DOM.
 *
 * # Why a tree instead of the prior flat two-pane cap
 *
 * Before this slice, `TerminalTabsModel` hard-capped every tab at exactly two
 * panes and stored one tab-level `flex-direction`-shaped orientation — see
 * that file's own (now superseded) "Split cap" doc section. This slice's
 * contract (`docs/research/2026-08-03-complete-terminal.md`'s "架构裁定 §4")
 * requires recursive splitting up to 8 panes, with each split point (not the
 * whole tab) independently remembering whether it divides its region into a
 * row (side-by-side) or a column (stacked) — exactly the shape a binary tree
 * gives for free: every internal node *is* one split point, carrying its own
 * `orientation`; every leaf *is* one pane.
 *
 * # Persistent, not mutated in place
 *
 * Every function here returns a **new** tree (or a piece of one) rather than
 * mutating an existing node — `TerminalSplitNode` values are effectively
 * immutable (each constructor path below `Object.freeze`s what it builds).
 * This is what lets `TerminalTabsModel` hand out a tab snapshot's `tree`
 * field directly (no defensive deep-clone needed) while still safely
 * replacing `tab.tree` wholesale on every split/close — the old tree a
 * caller may still be holding a reference to (e.g. a `TerminalTabSnapshot`
 * fetched before the mutation) is simply never touched by a later mutation.
 *
 * # Split: replace a leaf with a two-child split
 *
 * [`splitTreeLeaf`] finds `targetPaneId`'s leaf anywhere in the tree and
 * replaces it with a new internal split node whose `first` child is the
 * *existing* leaf (unchanged identity — the running pane keeps its position)
 * and whose `second` child is a brand new leaf for `newPaneId`. This is the
 * "split 只替换当前活动叶子" rule from the architecture doc: splitting never
 * touches any other leaf in the tree, no matter how deep `targetPaneId` is
 * nested.
 *
 * # Close: remove a leaf, promote its sibling
 *
 * [`removeTreeLeaf`] is the inverse: removing `paneId`'s leaf deletes its
 * parent split node entirely and splices the leaf's **sibling subtree**
 * directly into the grandparent's place — "其兄弟子树上提（树收缩）" from the
 * architecture doc. If `paneId` is the tree's *only* leaf (no parent to
 * splice), there is nothing left to promote — the caller (`TerminalTabsModel`)
 * reads the `"empty"` result as "the whole tab must close", the same
 * long-standing meaning `closeTab` already gives that case.
 */

export type TerminalSplitOrientation = "row" | "column";

/** One pane. */
export interface TerminalSplitLeaf {
	readonly kind: "leaf";
	readonly paneId: string;
}

/** One split point: divides its region along `orientation` ("row" = side by
 * side, "column" = stacked) into `first` and `second`, each independently
 * either another split or a leaf — this is what makes orientation a
 * per-split-point property rather than one flat, tab-wide setting. */
export interface TerminalSplitBranch {
	readonly kind: "split";
	readonly orientation: TerminalSplitOrientation;
	readonly first: TerminalSplitNode;
	readonly second: TerminalSplitNode;
}

export type TerminalSplitNode = TerminalSplitLeaf | TerminalSplitBranch;

/** A brand new tab/pane's starting tree — just its one pane, no splits yet. */
export function createSplitLeaf(paneId: string): TerminalSplitNode {
	return Object.freeze({ kind: "leaf", paneId });
}

function createSplitBranch(
	orientation: TerminalSplitOrientation,
	first: TerminalSplitNode,
	second: TerminalSplitNode,
): TerminalSplitNode {
	return Object.freeze({ kind: "split", orientation, first, second });
}

/** How many panes (leaves) this tree currently holds. */
export function countSplitPanes(node: TerminalSplitNode): number {
	return node.kind === "leaf"
		? 1
		: countSplitPanes(node.first) + countSplitPanes(node.second);
}

/** Every pane id in this tree, in left-to-right / top-to-bottom document
 * order (a pre-order traversal — `first` before `second` at every split) —
 * this is also the order `PlainTerminalView` mounts panes into the DOM in, so
 * it matches what a reader would see scanning the rendered layout
 * left-to-right, top-to-bottom. */
export function splitPaneIdsInOrder(
	node: TerminalSplitNode,
): readonly string[] {
	return node.kind === "leaf"
		? [node.paneId]
		: [...splitPaneIdsInOrder(node.first), ...splitPaneIdsInOrder(node.second)];
}

/** The leftmost/topmost pane id in this tree — used as the fallback new
 * active pane once the previously active one has just been closed. */
export function firstSplitPaneId(node: TerminalSplitNode): string {
	return node.kind === "leaf" ? node.paneId : firstSplitPaneId(node.first);
}

/**
 * Replaces `targetPaneId`'s leaf with a new split of `orientation` whose
 * `first` child is that same (unchanged) leaf and whose `second` child is a
 * fresh leaf for `newPaneId`. Returns `undefined` (never partially applied)
 * if `targetPaneId` does not exist anywhere in `node` — the caller must not
 * install a half-built tree in that case.
 */
export function splitTreeLeaf(
	node: TerminalSplitNode,
	targetPaneId: string,
	orientation: TerminalSplitOrientation,
	newPaneId: string,
): TerminalSplitNode | undefined {
	if (node.kind === "leaf") {
		return node.paneId === targetPaneId
			? createSplitBranch(orientation, node, createSplitLeaf(newPaneId))
			: undefined;
	}
	const first = splitTreeLeaf(node.first, targetPaneId, orientation, newPaneId);
	if (first !== undefined) {
		return createSplitBranch(node.orientation, first, node.second);
	}
	const second = splitTreeLeaf(
		node.second,
		targetPaneId,
		orientation,
		newPaneId,
	);
	return second === undefined
		? undefined
		: createSplitBranch(node.orientation, node.first, second);
}

/** The result of removing one leaf from a tree — see [`removeTreeLeaf`]. */
export type TerminalSplitRemoval =
	| { readonly kind: "removed"; readonly tree: TerminalSplitNode }
	| { readonly kind: "empty" };

/**
 * Removes `paneId`'s leaf from `node`, promoting its sibling subtree into
 * the parent split's place (see the module doc's "Close" section). Returns
 * `{kind: "empty"}` only when `node` itself is exactly the target leaf (no
 * parent to splice — the whole tree disappears); returns `undefined` if
 * `paneId` does not exist anywhere in `node`.
 */
export function removeTreeLeaf(
	node: TerminalSplitNode,
	paneId: string,
): TerminalSplitRemoval | undefined {
	if (node.kind === "leaf") {
		return node.paneId === paneId ? { kind: "empty" } : undefined;
	}
	if (node.first.kind === "leaf" && node.first.paneId === paneId) {
		return { kind: "removed", tree: node.second };
	}
	if (node.second.kind === "leaf" && node.second.paneId === paneId) {
		return { kind: "removed", tree: node.first };
	}
	const first = removeTreeLeaf(node.first, paneId);
	if (first !== undefined) {
		// A non-leaf child can never itself resolve to "empty" — removing one
		// leaf from a subtree that holds at least two never leaves zero.
		const firstTree = first.kind === "removed" ? first.tree : node.first;
		return {
			kind: "removed",
			tree: createSplitBranch(node.orientation, firstTree, node.second),
		};
	}
	const second = removeTreeLeaf(node.second, paneId);
	if (second !== undefined) {
		const secondTree = second.kind === "removed" ? second.tree : node.second;
		return {
			kind: "removed",
			tree: createSplitBranch(node.orientation, node.first, secondTree),
		};
	}
	return undefined;
}
