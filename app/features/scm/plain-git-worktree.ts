import type {
	GitWorktreeEntry,
	GitWorktreeListResult,
} from "../../platform/tauri/contracts";

/**
 * `F090` S5 — the worktree panel's own narrow-bridge read controller
 * (`docs/research/2026-07-26-git-history.md`'s slice 6). Mirrors
 * `PlainGitStashController`'s/`PlainGitGraphController`'s own "plain data +
 * narrow bridge" testability discipline: no editor/DOM dependency at all, so
 * this is fully unit-testable with a fake bridge. Only the read half
 * (`gitWorktreeList`) lives here — the write half (add/remove) is driven
 * directly by `plain-git-worktree-view.ts`'s own methods against
 * `PlainBridge`, exactly like `PlainGitStashView`'s own push/apply/pop/drop
 * mutation methods call the bridge directly rather than through a separate
 * controller (this domain's own established split: a controller owns *read*
 * state, a view owns *mutation* call sites so the confirmation-gate/AST-lock
 * story stays exactly the audited call sites per bridge method, the same
 * discipline `plain-scm-stash.ts`'s/`plain-scm-worktree.ts`'s own module doc
 * comments establish).
 */
export interface PlainGitWorktreeBridge {
	gitWorktreeList(): Promise<GitWorktreeListResult>;
}

const EMPTY_WORKTREE_LIST_RESULT: GitWorktreeListResult = Object.freeze({
	entries: Object.freeze([]),
	truncated: false,
});

export class PlainGitWorktreeController {
	#result: GitWorktreeListResult = EMPTY_WORKTREE_LIST_RESULT;

	constructor(private readonly bridge: PlainGitWorktreeBridge) {}

	get entries(): readonly GitWorktreeEntry[] {
		return this.#result.entries;
	}

	get truncated(): boolean {
		return this.#result.truncated;
	}

	async refresh(): Promise<void> {
		this.#result = await this.bridge.gitWorktreeList();
	}
}

/** A short, human-readable display label for one worktree's own checked-out
 * state — `"main"`/`"detached at <sha7>"`/`"bare"` or the branch's own short
 * name (the `refs/heads/` prefix stripped, mirroring
 * `plain-git-refs.ts`'s own `RefEntry.shortName` convention, computed here
 * client-side rather than duplicating that stripping logic as a shared
 * export since this is the only place it is needed). */
export function worktreeHeadStateLabel(entry: GitWorktreeEntry): string {
	switch (entry.headState.kind) {
		case "branch": {
			const shortName = entry.headState.refName.startsWith("refs/heads/")
				? entry.headState.refName.slice("refs/heads/".length)
				: entry.headState.refName;
			return shortName;
		}
		case "detached": {
			const shortSha = entry.headSha?.slice(0, 7) ?? "unknown";
			return `detached at ${shortSha}`;
		}
		case "bare": {
			return "bare";
		}
	}
}

/** A short, human-readable display label for one worktree entry as a whole —
 * used both by the panel's own row rendering and as the opaque
 * `worktreeLabel` handed to `resolveWorktreeConfirmation`
 * (`plain-scm-worktree.ts`) so that module never needs to know
 * `GitWorktreeEntry`'s own shape. */
export function worktreeEntryLabel(entry: GitWorktreeEntry): string {
	const marker = entry.isMain ? "main — " : "";
	return `${marker}${worktreeHeadStateLabel(entry)} (${entry.path})`;
}
