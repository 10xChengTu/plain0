import type {
	DebugScope,
	DebugVariable,
	DebugVariablesResult,
} from "../../platform/tauri/contracts";

/** How many entries one `debugVariables` page requests — an arbitrary but
 * reasonable UI page size (not a protocol constant); the adapter itself
 * still decides how it actually slices its own children by `start`/`count`
 * (see `PlainBridge.debugVariables`'s own doc comment). */
export const VARIABLES_PAGE_SIZE = 100;

export interface ExpandedVariablesNode {
	variables: DebugVariable[];
	/** The declared child count from the *parent* (`indexedVariables`/
	 * `namedVariables`), or `null` when the adapter never reported one — in
	 * which case this view treats the first page as the complete result
	 * (no "Load more" affordance), rather than guessing. */
	total: number | null;
}

export function declaredCount(
	entity: Pick<
		DebugScope | DebugVariable,
		"indexedVariables" | "namedVariables"
	>,
): number | null {
	return entity.indexedVariables ?? entity.namedVariables ?? null;
}

/** The narrow slice of `DebugSessionController` a `DebugVariablesTree` needs
 * to fetch one page of a `variablesReference`'s children — injected rather
 * than reaching for `getPlainDebugRuntime()` itself so this class stays
 * DOM/runtime-free and directly unit-testable against a fake fetcher, same
 * testability discipline as `DebugSessionController`'s own narrow
 * `DebugSessionBridge` slice. */
export type VariablesFetcher = (
	variablesReference: number,
	start: number,
	count: number,
) => Promise<DebugVariablesResult | undefined>;

/**
 * `F100` S3 introduced this as `PlainDebugVariablesView`'s own private
 * `#expanded` map/`#toggle`/`#loadMore` trio; `F210` S2 extracts it verbatim
 * (same fetch shape, same "collapsed by default, one `debugVariables` call
 * per expand, real `start`/`count` pagination — never a client-side slice of
 * an already-fully-fetched array" contract) so `PlainDebugWatchView` can
 * reuse the identical expansion/pagination engine for a watch expression's
 * own `variablesReference`, instead of building a second tree
 * implementation. Every method here is data-only (no DOM, no
 * `@codingame/monaco-vscode-api` import at all) — directly unit-testable
 * against a fake {@link VariablesFetcher} with no browser environment
 * needed. Rendering lives in the sibling `plain-debug-variables-tree-render.ts`
 * (kept in its own module specifically *because* it needs
 * `addDisposableListener`, which — imported at module scope — would drag a
 * `window` dependency into this file and break that unit-testability).
 */
export class DebugVariablesTree {
	readonly #fetch: VariablesFetcher;
	readonly #expanded = new Map<number, ExpandedVariablesNode>();

	constructor(fetch: VariablesFetcher) {
		this.#fetch = fetch;
	}

	clear(): void {
		this.#expanded.clear();
	}

	isExpanded(reference: number): boolean {
		return this.#expanded.has(reference);
	}

	node(reference: number): ExpandedVariablesNode | undefined {
		return this.#expanded.get(reference);
	}

	/** Drops `reference`'s own recorded page(s) without fetching anything —
	 * both the collapse-click path and callers pruning a subtree they know is
	 * about to go stale (e.g. a watch expression about to be re-evaluated). */
	collapse(reference: number): void {
		this.#expanded.delete(reference);
	}

	/** Fetches `reference`'s first page and records it, overwriting whatever
	 * (if anything) was already recorded — used both by a fresh expand-click
	 * and by a caller deliberately re-expanding a reference it already knows
	 * is new (a watch expression's re-evaluated result). Returns whether the
	 * fetch succeeded (a thrown rejection leaves any prior state untouched
	 * and reports failure, exactly like the pre-extraction `#toggle` did). */
	async expand(reference: number, countHint: number | null): Promise<boolean> {
		try {
			const result = await this.#fetch(reference, 0, VARIABLES_PAGE_SIZE);
			this.#expanded.set(reference, {
				variables: [...(result?.variables ?? [])],
				total: countHint,
			});
			return true;
		} catch {
			return false;
		}
	}

	/** Collapses an expanded reference, or expands a collapsed one — returns
	 * whether the map actually changed (an expand attempt that throws leaves
	 * it unchanged), so a caller knows whether a re-render is warranted. */
	async toggle(reference: number, countHint: number | null): Promise<boolean> {
		if (this.#expanded.has(reference)) {
			this.#expanded.delete(reference);
			return true;
		}
		return this.expand(reference, countHint);
	}

	/** Fetches the next page after whatever has already been loaded and
	 * appends it — a no-op (returning `false`) if `reference` is not
	 * currently expanded. */
	async loadMore(reference: number): Promise<boolean> {
		const node = this.#expanded.get(reference);
		if (node === undefined) {
			return false;
		}
		try {
			const result = await this.#fetch(
				reference,
				node.variables.length,
				VARIABLES_PAGE_SIZE,
			);
			node.variables = [...node.variables, ...(result?.variables ?? [])];
			return true;
		} catch {
			return false;
		}
	}
}
