import type {
	GitHistoryEntry,
	GitHistoryListResult,
	GitHistorySearchMode,
	GitLineHistoryDetail,
	GitLogLineRange,
} from "../../platform/tauri/contracts";

/**
 * `F090` S1 — file and line history (`docs/research/2026-07-26-git-history.md`'s
 * slice 2). Self-built, never consuming any vendor SCM history machinery —
 * the same "自建视图" decision `plain-git-blame.ts`'s own doc comment records
 * for `F090` S0.
 *
 * Every piece of logic that can be pure and unit-tested is: summary
 * formatting and the [`PlainGitHistoryController`] state machine driving
 * both "whole-file history" ([`PlainGitHistoryController.loadFileHistory`])
 * and "line history list + drill-down"
 * ([`PlainGitHistoryController.loadLineHistory`]/
 * [`PlainGitHistoryController.openLineHistoryDetail`]). Only the view
 * (`plain-git-history-view.ts`) touches a live editor/DOM, and even that
 * only through this controller's narrow interface.
 */
export interface PlainGitHistoryBridge {
	gitFileHistory(path: string): Promise<GitHistoryListResult>;
	gitHistorySearch(
		mode: GitHistorySearchMode,
		query: string,
	): Promise<GitHistoryListResult>;
	gitLineHistoryList(
		path: string,
		range: GitLogLineRange,
	): Promise<GitHistoryListResult>;
	gitLineHistoryDetail(
		path: string,
		range: GitLogLineRange,
		skip: number,
		expectedSha: string,
	): Promise<GitLineHistoryDetail>;
}

const EMPTY_HISTORY_LIST: GitHistoryListResult = Object.freeze({
	entries: Object.freeze([]),
	truncated: false,
});

/** The short, 7-character abbreviated sha convention used throughout this
 * codebase's blame feature (`PlainGitBlameHoverProvider`'s own
 * `entry.commitSha.slice(0, 7)`), reused here for consistency. */
export function shortCommitSha(sha: string): string {
	return sha.slice(0, 7);
}

/** A history row's one-line display text — the message's first line,
 * trimmed. `GitHistoryEntry.message` is the commit's full body (never
 * truncated server-side — see that type's own doc comment for why author/
 * date metadata is not fetched alongside it); this is the pure, sanctioned
 * place a caller derives a compact row label from it. Falls back to a fixed
 * placeholder for the (rare, but real — `git commit --allow-empty-message`)
 * case of a genuinely empty message, so a row is never rendered as blank
 * text a user could mistake for a loading/error state. */
export function historyEntrySummary(entry: GitHistoryEntry): string {
	const firstLine = entry.message.split("\n", 1)[0] ?? "";
	const trimmed = firstLine.trim();
	return trimmed.length > 0 ? trimmed : "(no commit message)";
}

/**
 * Drives both the "whole-file history" list and the "line history list +
 * drill-down into one entry's diff hunk" flow against a narrow
 * [`PlainGitHistoryBridge`] — no editor/DOM dependency, so this is fully
 * unit-testable with a fake bridge (mirrors `PlainGitBlameFileIndex`'s own
 * "plain data + narrow bridge" testability discipline).
 *
 * # Why `openLineHistoryDetail` takes an index, not a sha
 *
 * [`openLineHistoryDetail`] always re-derives both `path`/`range` (from the
 * most recent [`loadLineHistory`] call) and `expectedSha` (from that same
 * result's own `entries[index].sha`) — a caller can never accidentally pass
 * a mismatched path/range/sha combination the way it could if this method
 * took all four as independent parameters. The Rust side
 * (`src-tauri/src/git/log.rs`'s `line_history_detail`) still independently
 * re-verifies the sha it actually lands on against `expectedSha` (see that
 * function's own doc comment) — this controller's own bookkeeping discipline
 * and that server-side verification are complementary, not redundant: this
 * guards against a caller-side bug (stale local state), the server-side
 * check guards against the underlying history genuinely changing between
 * this controller's `loadLineHistory` call and the `openLineHistoryDetail`
 * call that follows it.
 */
export class PlainGitHistoryController {
	#searchMode: GitHistorySearchMode | undefined;
	#searchQuery: string | undefined;
	#searchHistory: GitHistoryListResult = EMPTY_HISTORY_LIST;

	#fileHistoryPath: string | undefined;
	#fileHistory: GitHistoryListResult = EMPTY_HISTORY_LIST;

	#linePath: string | undefined;
	#lineRange: GitLogLineRange | undefined;
	#lineHistory: GitHistoryListResult = EMPTY_HISTORY_LIST;

	constructor(private readonly bridge: PlainGitHistoryBridge) {}

	get fileHistoryPath(): string | undefined {
		return this.#fileHistoryPath;
	}

	get searchMode(): GitHistorySearchMode | undefined {
		return this.#searchMode;
	}

	get searchQuery(): string | undefined {
		return this.#searchQuery;
	}

	get searchHistory(): GitHistoryListResult {
		return this.#searchHistory;
	}

	async loadSearch(
		mode: GitHistorySearchMode,
		query: string,
	): Promise<GitHistoryListResult> {
		const result = await this.bridge.gitHistorySearch(mode, query);
		this.#searchMode = mode;
		this.#searchQuery = query.trim();
		this.#searchHistory = result;
		return result;
	}

	clearSearchHistory(): void {
		this.#searchMode = undefined;
		this.#searchQuery = undefined;
		this.#searchHistory = EMPTY_HISTORY_LIST;
	}

	get fileHistory(): GitHistoryListResult {
		return this.#fileHistory;
	}

	get lineHistoryPath(): string | undefined {
		return this.#linePath;
	}

	get lineHistoryRange(): GitLogLineRange | undefined {
		return this.#lineRange;
	}

	get lineHistory(): GitHistoryListResult {
		return this.#lineHistory;
	}

	async loadFileHistory(path: string): Promise<GitHistoryListResult> {
		const result = await this.bridge.gitFileHistory(path);
		this.#fileHistoryPath = path;
		this.#fileHistory = result;
		return result;
	}

	async loadLineHistory(
		path: string,
		range: GitLogLineRange,
	): Promise<GitHistoryListResult> {
		const result = await this.bridge.gitLineHistoryList(path, range);
		this.#linePath = path;
		this.#lineRange = range;
		this.#lineHistory = result;
		return result;
	}

	/** Clears whatever line-history list/path/range this controller is
	 * currently holding — used when the view navigates away from the
	 * selection/file that list was built for, so a stale
	 * [`openLineHistoryDetail`] call is never even attempted against
	 * mismatched state. */
	clearLineHistory(): void {
		this.#linePath = undefined;
		this.#lineRange = undefined;
		this.#lineHistory = EMPTY_HISTORY_LIST;
	}

	/** Re-reads whichever file/line queries are currently visible after a
	 * product-level Git invalidation. Empty panes stay empty and cause no IPC. */
	async refreshLoadedHistory(): Promise<void> {
		const requests: Promise<unknown>[] = [];
		if (this.#searchMode !== undefined && this.#searchQuery !== undefined) {
			requests.push(this.loadSearch(this.#searchMode, this.#searchQuery));
		}
		if (this.#fileHistoryPath !== undefined) {
			requests.push(this.loadFileHistory(this.#fileHistoryPath));
		}
		if (this.#linePath !== undefined && this.#lineRange !== undefined) {
			requests.push(this.loadLineHistory(this.#linePath, this.#lineRange));
		}
		await Promise.all(requests);
	}

	async openLineHistoryDetail(index: number): Promise<GitLineHistoryDetail> {
		if (this.#linePath === undefined || this.#lineRange === undefined) {
			throw new Error(
				"PlainGitHistoryController.openLineHistoryDetail called before loadLineHistory",
			);
		}
		const entry = this.#lineHistory.entries[index];
		if (entry === undefined) {
			throw new Error(
				"PlainGitHistoryController.openLineHistoryDetail: index out of range",
			);
		}
		return this.bridge.gitLineHistoryDetail(
			this.#linePath,
			this.#lineRange,
			index,
			entry.sha,
		);
	}
}
