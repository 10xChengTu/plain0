import type {
	GitStashEntry,
	GitStashListResult,
} from "../../platform/tauri/contracts";

/**
 * `F090` S4 — the stash panel's own narrow-bridge read controller
 * (`docs/research/2026-07-26-git-history.md`'s slice 5). Mirrors
 * `PlainGitGraphController`'s/`PlainGitHistoryController`'s own "plain data +
 * narrow bridge" testability discipline: no editor/DOM dependency at all, so
 * this is fully unit-testable with a fake bridge. Only the read half
 * (`gitStashList`) lives here — the write half (push/apply/pop/drop) is
 * driven directly by `plain-git-stash-view.ts`'s own methods against
 * `PlainBridge`, exactly like `PlainScmView`'s own `discardResources`/
 * `fetchFromRemote` mutation methods call the bridge directly rather than
 * through a separate controller (this domain's own established split: a
 * controller owns *read* state, a view owns *mutation* call sites so the
 * confirmation-gate/AST-lock story stays exactly one production call site
 * per bridge method, the same discipline `plain-scm-discard.ts`'s/
 * `plain-scm-network.ts`'s own module doc comments establish).
 */
export interface PlainGitStashBridge {
	gitStashList(): Promise<GitStashListResult>;
}

const EMPTY_STASH_LIST_RESULT: GitStashListResult = Object.freeze({
	entries: Object.freeze([]),
	truncated: false,
});

export class PlainGitStashController {
	#result: GitStashListResult = EMPTY_STASH_LIST_RESULT;

	constructor(private readonly bridge: PlainGitStashBridge) {}

	get entries(): readonly GitStashEntry[] {
		return this.#result.entries;
	}

	get truncated(): boolean {
		return this.#result.truncated;
	}

	async refresh(): Promise<void> {
		this.#result = await this.bridge.gitStashList();
	}
}

/** The message's first line only — mirrors `plain-git-history.ts`'s own
 * `historyEntrySummary` convention (`GitStashEntry.message` is the full `%B`
 * body, never truncated server-side; a caller wanting a compact single-line
 * row derives it itself). */
export function stashEntrySummary(entry: GitStashEntry): string {
	const firstLine = entry.message.split("\n")[0] ?? "";
	return firstLine.length > 0 ? firstLine : entry.sha.slice(0, 7);
}

/** A short, human-readable display label for one stash entry — used both by
 * the panel's own row rendering and as the opaque `entryLabel` handed to
 * `resolveStashConfirmation` (`plain-scm-stash.ts`) so that module never
 * needs to know `GitStashEntry`'s own shape. */
export function stashEntryLabel(entry: GitStashEntry): string {
	return `#${entry.index} — ${stashEntrySummary(entry)}`;
}
