import type {
	GitLogGraphResult,
	GitRefsListResult,
} from "../../platform/tauri/contracts";
import {
	computeGraphLayout,
	type GraphLayoutResult,
} from "./plain-git-graph-layout";
import {
	buildRefBadgesBySha,
	groupRefsByKind,
	type GitRefBadge,
	type GroupedRefs,
} from "./plain-git-refs";

/**
 * `F090` S3 — the graph + refs sidebar's own narrow-bridge controller
 * (`docs/research/2026-07-26-git-history.md`'s slice 4). Mirrors
 * `PlainGitHistoryController`'s own "plain data + narrow bridge" testability
 * discipline: no editor/DOM dependency at all, so this is fully unit-testable
 * with a fake bridge — only `plain-git-graph-view.ts` touches a live
 * view/DOM, and even that only through this controller's own narrow
 * interface.
 */
export interface PlainGitGraphBridge {
	gitLogGraph(maxCount: number): Promise<GitLogGraphResult>;
	gitRefsList(): Promise<GitRefsListResult>;
}

const EMPTY_GRAPH_RESULT: GitLogGraphResult = Object.freeze({
	nodes: Object.freeze([]),
	truncated: false,
});
const EMPTY_REFS_RESULT: GitRefsListResult = Object.freeze({
	entries: Object.freeze([]),
	truncated: false,
});

/** A reasonable default display window — well within
 * `MAX_GRAPH_MAX_COUNT`/`MAX_GIT_LOG_GRAPH_MAX_COUNT` (5,000) server-side,
 * but generous enough to show a real repository's own recent history
 * without the caller needing to pick a number. */
export const DEFAULT_GRAPH_MAX_COUNT = 300;

/**
 * Drives both the graph's own DAG fetch+layout and the refs sidebar's own
 * fetch+grouping from a single `refresh()` call — the two are fetched
 * together (never separately) because the graph view's own per-node ref
 * badges join across both results (see [`refBadgesBySha`]).
 */
export class PlainGitGraphController {
	#graph: GitLogGraphResult = EMPTY_GRAPH_RESULT;
	#refs: GitRefsListResult = EMPTY_REFS_RESULT;

	constructor(private readonly bridge: PlainGitGraphBridge) {}

	get graph(): GitLogGraphResult {
		return this.#graph;
	}

	get refs(): GitRefsListResult {
		return this.#refs;
	}

	/** The graph's own DAG, laid out into swimlanes — recomputed on every
	 * access (not cached), a deliberate simplicity trade-off: this is a pure
	 * function over `graph.nodes` alone, and repeated access is not this
	 * view's own hot path (it only re-renders after an explicit
	 * `refresh()`). */
	get layout(): GraphLayoutResult {
		return computeGraphLayout(this.#graph.nodes);
	}

	get groupedRefs(): GroupedRefs {
		return groupRefsByKind(this.#refs);
	}

	get refBadgesBySha(): ReadonlyMap<string, readonly GitRefBadge[]> {
		return buildRefBadgesBySha(this.#refs);
	}

	async refresh(maxCount: number = DEFAULT_GRAPH_MAX_COUNT): Promise<void> {
		const [graph, refs] = await Promise.all([
			this.bridge.gitLogGraph(maxCount),
			this.bridge.gitRefsList(),
		]);
		this.#graph = graph;
		this.#refs = refs;
	}
}
