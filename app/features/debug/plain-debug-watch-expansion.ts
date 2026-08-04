import {
	declaredCount,
	type DebugVariablesTree,
} from "./plain-debug-variables-tree";

/**
 * `F210` S2 — the Watch-only half of nested expansion: surviving a
 * re-evaluate (a fresh `debug_evaluate` call, hence a brand-new
 * adapter-minted `variablesReference` every time, per DAP's own semantics)
 * without losing which nested nodes the user had expanded. Pure and
 * DOM/`ViewPane`-free — unit-testable against a real `DebugVariablesTree`
 * plus a fake fetcher, same testability discipline as
 * `plain-debug-session.ts`'s own controller.
 *
 * Approach: a node's identity across a re-evaluate is its chain of variable
 * *names* from the watch expression's own root — names, unlike
 * adapter-minted reference numbers, survive a re-evaluate. Right before
 * firing a fresh evaluate for one entry, {@link collectExpandedPaths} walks
 * that entry's *current* expanded subtree (whatever is expanded right now,
 * under the *old* reference) and records each expanded node's own name path;
 * {@link pruneExpandedSubtree} then drops that old subtree from the shared
 * tree outright (bounding memory — a reference that is about to go stale is
 * never rendered again). Once the fresh evaluate result lands (a new root
 * reference), {@link restoreExpandedPaths} replays the recorded paths
 * against the new tree, re-issuing exactly the same `debug_variables` fetch
 * a real expand-click would (paging further if a still-expanded
 * descendant's name is not on the first page yet) — a real refetch under
 * the new reference, not a reuse of the old (now-stale) children.
 */

/** A path is the ordered chain of variable names from a watch entry's own
 * root down to some descendant node — `[]` denotes the entry's own root
 * node itself. Encoded as JSON so arbitrary adapter-supplied variable names
 * (which may contain any character) never collide with a chosen separator. */
function encodeVariablePath(path: readonly string[]): string {
	return JSON.stringify(path);
}

function decodeVariablePath(encoded: string): string[] {
	return JSON.parse(encoded) as string[];
}

/** Walks `reference`'s currently-expanded subtree (stopping the instant a
 * node is not expanded — an expanded node's own un-expanded children are
 * never visited, since nothing under them is recorded either) and records
 * each expanded node's own path into `out`. */
export function collectExpandedPaths(
	tree: DebugVariablesTree,
	reference: number,
	prefix: readonly string[],
	out: Set<string>,
): void {
	if (reference === 0 || !tree.isExpanded(reference)) {
		return;
	}
	out.add(encodeVariablePath(prefix));
	const node = tree.node(reference);
	if (node === undefined) {
		return;
	}
	for (const variable of node.variables) {
		collectExpandedPaths(
			tree,
			variable.variablesReference,
			[...prefix, variable.name],
			out,
		);
	}
}

/** Drops `reference` and every descendant it currently has recorded as
 * expanded from `tree` — called on a reference that is about to become
 * stale (a fresh evaluate is about to replace it, or the watch expression
 * itself is being removed), so the shared tree never accumulates dead
 * subtrees no path will ever point back to. */
export function pruneExpandedSubtree(
	tree: DebugVariablesTree,
	reference: number,
): void {
	if (reference === 0) {
		return;
	}
	const node = tree.node(reference);
	tree.collapse(reference);
	if (node === undefined) {
		return;
	}
	for (const variable of node.variables) {
		pruneExpandedSubtree(tree, variable.variablesReference);
	}
}

/** Whether some path in `expandedPaths` names a child of `prefix` whose own
 * name is not yet among `loadedNames` — i.e. whether {@link
 * ensureDeeperNamesLoaded} still has a reason to fetch another page. */
function deeperNameStillMissing(
	prefix: readonly string[],
	loadedNames: ReadonlySet<string>,
	expandedPaths: ReadonlySet<string>,
): boolean {
	for (const encoded of expandedPaths) {
		const path = decodeVariablePath(encoded);
		if (
			path.length > prefix.length &&
			prefix.every((segment, index) => path[index] === segment) &&
			!loadedNames.has(path[prefix.length]!)
		) {
			return true;
		}
	}
	return false;
}

/** A still-expanded descendant's name may not be on `reference`'s first
 * fetched page (the user had clicked "Load more" before the re-evaluate) —
 * keeps paging (real `debug_variables` calls, never a guess) until every
 * such name has been found or the adapter's own declared total is
 * exhausted. */
async function ensureDeeperNamesLoaded(
	tree: DebugVariablesTree,
	reference: number,
	prefix: readonly string[],
	expandedPaths: ReadonlySet<string>,
): Promise<void> {
	for (;;) {
		const node = tree.node(reference);
		if (node === undefined) {
			return;
		}
		const loadedNames = new Set(
			node.variables.map((variable) => variable.name),
		);
		if (
			!deeperNameStillMissing(prefix, loadedNames, expandedPaths) ||
			node.total === null ||
			node.variables.length >= node.total
		) {
			return;
		}
		if (!(await tree.loadMore(reference))) {
			return;
		}
	}
}

/** Replays `expandedPaths` (as collected by {@link collectExpandedPaths}
 * against the *old* tree) onto `reference`'s fresh subtree. A path whose
 * named variable is no longer present after the re-evaluate is silently
 * left collapsed — there is nothing to expand, not a failure. */
export async function restoreExpandedPaths(
	tree: DebugVariablesTree,
	reference: number,
	countHint: number | null,
	prefix: readonly string[],
	expandedPaths: ReadonlySet<string>,
): Promise<void> {
	if (reference === 0 || !expandedPaths.has(encodeVariablePath(prefix))) {
		return;
	}
	if (!(await tree.expand(reference, countHint))) {
		return;
	}
	await ensureDeeperNamesLoaded(tree, reference, prefix, expandedPaths);
	const node = tree.node(reference);
	if (node === undefined) {
		return;
	}
	await Promise.all(
		node.variables.map((variable) =>
			restoreExpandedPaths(
				tree,
				variable.variablesReference,
				declaredCount(variable),
				[...prefix, variable.name],
				expandedPaths,
			),
		),
	);
}
