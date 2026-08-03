import type { TerminalScrollbackRow } from "../../platform/tauri/contracts";

/**
 * Pure, DOM/IPC-free "terminal-buffer find" state machine (`F190` S5 "find
 * and live scrollback" — see
 * `docs/research/2026-08-03-complete-terminal.md`'s "架构裁定 §2"). Like
 * `plain-terminal-scroll.ts`'s `TerminalScrollController`, this module only
 * tracks *state* (the current query, its matches, which one is active) —
 * it never fetches scrollback, touches the DOM or decides when to scroll
 * the view; `TerminalPaneController` owns all of that, feeding this class a
 * plain `readonly string[]` corpus (via [`TerminalFindController.setLines`])
 * built from its own scrollback cache plus the live viewport's current
 * text (see that class's own module doc for exactly how "查询集合 = 最多
 * 10,000 行 retained scrollback + 当前 viewport" is assembled).
 *
 * # Matching
 *
 * Plain (non-regex) substring search, case-sensitive or not per
 * [`TerminalFindController.setCaseSensitive`], scanning `lines` in order
 * and finding **non-overlapping** occurrences per line (advancing past each
 * match's own end before searching for the next one on that line — the same
 * convention `String.prototype.matchAll` and every mainstream find widget
 * uses). An empty query always yields zero matches (never "matches
 * everywhere") — this also sidesteps a would-be infinite loop from a
 * zero-length needle.
 *
 * # Hard upper bounds
 *
 * Per the architecture doc's "任何查询、匹配数和高亮 DOM 都有硬上限，不能把
 * PTY 输出放大成无界节点":
 *
 * - [`TERMINAL_FIND_MAX_QUERY_LENGTH`]: [`TerminalFindController.setQuery`]
 *   silently truncates any longer input to this length (never throws, never
 *   refuses the call) and reports `queryTruncated: true` in the resulting
 *   [`TerminalFindState`] so a caller can show an accurate "query truncated"
 *   status instead of the query silently behaving as if the extra
 *   characters were never typed.
 * - [`TERMINAL_FIND_MAX_MATCHES`]: matching stops the instant this many
 *   matches have been found (even mid-line), reporting
 *   `matchesTruncated: true`. This bounds both the state this class retains
 *   *and* the worst-case scan cost of a pathological query (e.g. a single
 *   common character) against the full 10,000+ line corpus.
 * - [`TERMINAL_FIND_MAX_HIGHLIGHT_NODES`]: not enforced by this class at all
 *   (it has no notion of "on screen") — `TerminalPaneController` applies
 *   this bound when deciding how many of `state.matches` to actually turn
 *   into highlight DOM nodes for whatever window (live viewport or a
 *   scrollback slice) is currently painted; exported from here purely so
 *   both the pane controller and this module's own doc stay anchored to one
 *   shared constant.
 */

/** Hard cap on the find query string length — see the module doc. */
export const TERMINAL_FIND_MAX_QUERY_LENGTH = 256;

/** Hard cap on the total number of matches this controller will ever track
 * for one query — see the module doc. */
export const TERMINAL_FIND_MAX_MATCHES = 5_000;

/** Hard cap on how many match highlight DOM nodes `TerminalPaneController`
 * may paint at once — see the module doc's "Hard upper bounds" section.
 * Enforced entirely by that class, not by this one. */
export const TERMINAL_FIND_MAX_HIGHLIGHT_NODES = 300;

/** One match: `lineIndex` indexes into whatever `lines` array was last
 * passed to [`TerminalFindController.setLines`]; `start`/`end` are a
 * half-open `[start, end)` column range within that line (`end - start`
 * always equals the active query's length). */
export interface TerminalFindMatch {
	readonly lineIndex: number;
	readonly start: number;
	readonly end: number;
}

/** Immutable snapshot of one [`TerminalFindController`]'s current state —
 * everything a caller needs to render a find widget's count/nav UI and
 * decide which matches to highlight. */
export interface TerminalFindState {
	/** The active query, already truncated to
	 * [`TERMINAL_FIND_MAX_QUERY_LENGTH`] if a longer one was supplied. */
	readonly query: string;
	readonly caseSensitive: boolean;
	readonly matches: readonly TerminalFindMatch[];
	/** Index into `matches` of the currently "active" (navigated-to) match,
	 * or `undefined` when `matches` is empty. */
	readonly activeMatchIndex: number | undefined;
	/** `true` when the most recent `setQuery` call was handed a query longer
	 * than [`TERMINAL_FIND_MAX_QUERY_LENGTH`] (and therefore truncated). */
	readonly queryTruncated: boolean;
	/** `true` when matching stopped early because [`TERMINAL_FIND_MAX_MATCHES`]
	 * was reached — `matches.length` is then exactly that cap, not the true
	 * (possibly larger) total match count. */
	readonly matchesTruncated: boolean;
}

const EMPTY_STATE_BASE = {
	matches: [] as readonly TerminalFindMatch[],
	activeMatchIndex: undefined,
	matchesTruncated: false,
} as const;

/** See the module doc. */
export class TerminalFindController {
	#lines: readonly string[] = [];
	#query = "";
	#caseSensitive = false;
	#matches: readonly TerminalFindMatch[] = [];
	#activeMatchIndex: number | undefined;
	#queryTruncated = false;
	#matchesTruncated = false;

	get state(): TerminalFindState {
		return Object.freeze({
			query: this.#query,
			caseSensitive: this.#caseSensitive,
			matches: this.#matches,
			activeMatchIndex: this.#activeMatchIndex,
			queryTruncated: this.#queryTruncated,
			matchesTruncated: this.#matchesTruncated,
		});
	}

	/** Replaces the searchable corpus (the caller's fresh scrollback +
	 * viewport snapshot) and re-runs the current query against it. Every
	 * `lineIndex` a resulting `state.matches` entry carries indexes into
	 * *this* `lines` array — a caller must not reuse match indices computed
	 * before a `setLines` call after calling it again with a different
	 * array. */
	setLines(lines: readonly string[]): TerminalFindState {
		this.#lines = lines;
		this.#recompute();
		return this.state;
	}

	/** Sets the query, truncating to [`TERMINAL_FIND_MAX_QUERY_LENGTH`] and
	 * re-running the search. Always resets `activeMatchIndex` to the first
	 * match (index `0`) when there is one — see the class doc's "Matching"
	 * section for why this class does not try to preserve "the same
	 * logical match" across a query edit. */
	setQuery(query: string): TerminalFindState {
		this.#queryTruncated = query.length > TERMINAL_FIND_MAX_QUERY_LENGTH;
		this.#query = this.#queryTruncated
			? query.slice(0, TERMINAL_FIND_MAX_QUERY_LENGTH)
			: query;
		this.#recompute();
		return this.state;
	}

	setCaseSensitive(caseSensitive: boolean): TerminalFindState {
		this.#caseSensitive = caseSensitive;
		this.#recompute();
		return this.state;
	}

	/** Advances to the next match, wrapping from the last match back to the
	 * first. A no-op (leaves `activeMatchIndex` at `undefined`) when there
	 * are no matches. */
	next(): TerminalFindState {
		this.#step(1);
		return this.state;
	}

	/** Moves to the previous match, wrapping from the first match back to
	 * the last. A no-op (leaves `activeMatchIndex` at `undefined`) when
	 * there are no matches. */
	previous(): TerminalFindState {
		this.#step(-1);
		return this.state;
	}

	/** Clears every field back to its initial value — used when a find
	 * widget closes, so a later reopen starts from a clean slate rather than
	 * momentarily showing the previous session's stale count/highlight. */
	reset(): TerminalFindState {
		this.#lines = [];
		this.#query = "";
		this.#caseSensitive = false;
		this.#matches = EMPTY_STATE_BASE.matches;
		this.#activeMatchIndex = EMPTY_STATE_BASE.activeMatchIndex;
		this.#queryTruncated = false;
		this.#matchesTruncated = EMPTY_STATE_BASE.matchesTruncated;
		return this.state;
	}

	#step(direction: 1 | -1): void {
		const count = this.#matches.length;
		if (count === 0) {
			this.#activeMatchIndex = undefined;
			return;
		}
		const current = this.#activeMatchIndex ?? (direction === 1 ? -1 : 0);
		this.#activeMatchIndex = (current + direction + count) % count;
	}

	#recompute(): void {
		if (this.#query.length === 0) {
			this.#matches = EMPTY_STATE_BASE.matches;
			this.#activeMatchIndex = EMPTY_STATE_BASE.activeMatchIndex;
			this.#matchesTruncated = false;
			return;
		}
		const needle = this.#caseSensitive
			? this.#query
			: this.#query.toLowerCase();
		const matches: TerminalFindMatch[] = [];
		let truncated = false;
		lineLoop: for (
			let lineIndex = 0;
			lineIndex < this.#lines.length;
			lineIndex += 1
		) {
			const rawLine = this.#lines[lineIndex]!;
			const haystack = this.#caseSensitive ? rawLine : rawLine.toLowerCase();
			let fromIndex = 0;
			for (;;) {
				const found = haystack.indexOf(needle, fromIndex);
				if (found === -1) {
					break;
				}
				matches.push(
					Object.freeze({
						lineIndex,
						start: found,
						end: found + needle.length,
					}),
				);
				if (matches.length >= TERMINAL_FIND_MAX_MATCHES) {
					truncated = true;
					break lineLoop;
				}
				fromIndex = found + needle.length;
			}
		}
		this.#matches = Object.freeze(matches);
		this.#matchesTruncated = truncated;
		this.#activeMatchIndex = matches.length > 0 ? 0 : undefined;
	}
}

/** Turns one fetched [`TerminalScrollbackRow`] into plain search text —
 * shared, DOM-free helper `TerminalPaneController` uses to build a find
 * corpus's scrollback half (see that class's own doc for the viewport
 * half, which needs a real `PlainTerminalRenderer` and so cannot live in
 * this DOM-free module). Trailing blank cells (an empty `graphemes`, i.e. a
 * space) are trimmed — they carry no real content and would otherwise
 * pollute matches against trailing whitespace/padding every wide row has;
 * non-trailing gaps are preserved as literal spaces so column offsets keep
 * lining up with real cell positions. */
export function terminalScrollbackRowText(row: TerminalScrollbackRow): string {
	let text = "";
	for (const cell of row.cells) {
		text += cell.graphemes === "" ? " " : cell.graphemes;
	}
	return text.trimEnd();
}
