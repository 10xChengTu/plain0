import type { GitGraphNode } from "../../platform/tauri/contracts";

/**
 * `F090` S3 — the graph view's own swimlane layout algorithm
 * (`docs/research/2026-07-26-git-history.md`'s slice 4, "Graph 技术选型"
 * section). This is a **from-scratch, independently designed and tested**
 * implementation of the general "incrementally assign a DAG's commits to
 * swimlane columns while walking newest-first" technique — the same
 * publicly-known technique tools like `gitk`/`tig`/VS Code's own
 * `scmHistory.ts` all implement some variant of. Per this codebase's own
 * hard boundary (`AGENTS.md` §7, and this feature's frozen research doc's
 * own "不导入,自行实现" decision), **no line of this file was copied,
 * adapted, or even consulted from any of those — this module was designed
 * from the algorithm's publicly-documented *concept* alone** ("a commit
 * continues its own lane onward to its first parent; each additional
 * parent either joins an already-waiting lane or opens a new one"), then
 * independently implemented and verified against this codebase's own real
 * git fixtures (`src-tauri/src/git/log/tests.rs`'s octopus-merge/root-commit
 * DAG) and hand-constructed edge cases (`plain-git-graph-layout.test.ts`).
 * It consumes only [`GitGraphNode`] (`sha`/`parents`/`subject` — plain
 * structured data), **never** `git log --graph`'s ASCII-art output (see
 * `src-tauri/src/git/log.rs`'s own module doc comment for why that format
 * is deliberately never parsed by any layer of this feature).
 *
 * # The algorithm
 *
 * `nodes` must already be in `--topo-order` (guaranteed by
 * `git::log::log_graph`'s own `GIT_LOG_GRAPH_ARGS` — see that module's own
 * doc comment): a commit is never listed before all of its children. This
 * lets the layout be computed in a single forward pass, maintaining an
 * ordered array of "swimlanes" — each one a `{ id, color }` pair meaning
 * "this column is currently waiting for the commit whose sha is `id`".
 * Processing node `n`:
 *
 * 1. Find every lane currently waiting for `n.sha`. Ordinarily exactly one;
 *    more than one only when `n` is the fork point of two-or-more branches
 *    that have not yet been merged back together (each of `n`'s children
 *    independently listed `n` as a parent). `n`'s own column is the first
 *    (leftmost) such lane; every other matching lane converges onto it here
 *    and is removed. If no lane was waiting at all (a tip with no
 *    yet-processed descendant — the very first node overall, or a
 *    genuinely unmerged branch tip), a brand-new lane opens for `n`.
 * 2. `n`'s own lane continues onward to `n`'s first parent (or closes
 *    entirely, for a root commit with zero parents).
 * 3. Each of `n`'s *other* parents (present only for a merge — the second
 *    parent of an ordinary 2-parent merge, or the third-and-beyond of an
 *    octopus merge) either already has a lane waiting for it elsewhere (a
 *    parent branch already being tracked as its own tip) or gets a
 *    brand-new lane opened here.
 *
 * This uniformly handles both "two branches converge at a merge commit"
 * and "two branches diverge from a shared, not-yet-merged ancestor" — both
 * are just "more than one lane ends up waiting for the same sha", resolved
 * whenever that sha is actually reached.
 */

interface Swimlane {
	readonly id: string;
	readonly color: number;
}

/** One laid-out node — `lane`/`color` are this node's own column and the
 * (cyclically reusable) color index [`computeGraphLayout`] assigned it;
 * `parentLanes` is the column each of `parents` (same order) should be
 * drawn continuing into, one entry per parent. */
export interface GraphLayoutNode {
	readonly sha: string;
	readonly parents: readonly string[];
	readonly subject: string;
	readonly lane: number;
	readonly color: number;
	readonly parentLanes: readonly number[];
}

export interface GraphLayoutResult {
	readonly nodes: readonly GraphLayoutNode[];
	/** The maximum number of concurrently occupied lanes/columns this layout
	 * ever used — a caller reserves at least this many columns' worth of
	 * horizontal space. */
	readonly laneCount: number;
}

export function computeGraphLayout(
	nodes: readonly GitGraphNode[],
): GraphLayoutResult {
	const swimlanes: Swimlane[] = [];
	let nextColor = 0;
	const laidOut: GraphLayoutNode[] = [];
	let laneCount = 0;

	for (const node of nodes) {
		const waitingLaneIndices: number[] = [];
		swimlanes.forEach((lane, index) => {
			if (lane.id === node.sha) {
				waitingLaneIndices.push(index);
			}
		});

		let laneIndex: number;
		let color: number;
		if (waitingLaneIndices.length === 0) {
			laneIndex = swimlanes.length;
			color = nextColor;
			nextColor += 1;
			swimlanes.push({ id: node.sha, color });
		} else {
			laneIndex = waitingLaneIndices[0] ?? 0;
			color = swimlanes[laneIndex]?.color ?? 0;
			// Every *other* lane that was also waiting for this same commit
			// converges onto `laneIndex` here — remove them, highest index
			// first, so earlier indices (including `laneIndex` itself) stay
			// valid throughout.
			for (let i = waitingLaneIndices.length - 1; i >= 1; i -= 1) {
				const removeAt = waitingLaneIndices[i];
				if (removeAt !== undefined) {
					swimlanes.splice(removeAt, 1);
				}
			}
		}

		const [firstParent, ...restParents] = node.parents;
		if (firstParent === undefined) {
			swimlanes.splice(laneIndex, 1);
		} else {
			swimlanes[laneIndex] = { id: firstParent, color };
		}
		for (const parentSha of restParents) {
			const alreadyWaiting = swimlanes.some((lane) => lane.id === parentSha);
			if (!alreadyWaiting) {
				swimlanes.push({ id: parentSha, color: nextColor });
				nextColor += 1;
			}
		}

		const parentLanes = node.parents.map((parentSha) => {
			const index = swimlanes.findIndex((lane) => lane.id === parentSha);
			return index === -1 ? laneIndex : index;
		});

		laneCount = Math.max(laneCount, swimlanes.length, laneIndex + 1);
		laidOut.push({
			sha: node.sha,
			parents: node.parents,
			subject: node.subject,
			lane: laneIndex,
			color,
			parentLanes,
		});
	}

	return { nodes: laidOut, laneCount };
}

/** A small, fixed, cyclically-reused palette of lane colors — self-designed
 * (not sampled from any third-party product's own palette; see this
 * module's own doc comment for the "no code or assets copied" boundary),
 * indexed by [`GraphLayoutNode.color`] modulo its own length. */
export const GRAPH_LANE_COLORS: readonly string[] = Object.freeze([
	"#4d79b3",
	"#d98a3d",
	"#5fa35f",
	"#b3574d",
	"#8a6bb4",
	"#3d9a9a",
	"#b3974d",
	"#a34d8a",
]);

export function graphLaneColor(colorIndex: number): string {
	const palette = GRAPH_LANE_COLORS;
	const length = palette.length;
	const index = ((colorIndex % length) + length) % length;
	return palette[index] ?? "#8a8a94";
}
