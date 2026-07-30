/**
 * Pure scrollback-viewing position state machine for one terminal pane
 * (F070 "多 tab/split/scrollback + 生命周期" slice). Deliberately DOM/IPC-free
 * at the type level — like `plain-terminal-input.ts`/`plain-terminal-trust.ts`,
 * this module only tracks *where* a pane is currently looking (the live
 * viewport, or `offset` rows back into history) and never itself fetches or
 * paints anything, so it is fully unit-testable in this repo's Node-only
 * Vitest environment.
 *
 * # Division of responsibility with `plain-terminal-pane.ts`
 *
 * This class intentionally does **not** know how much scrollback history
 * actually exists (that is only discovered by a real
 * `PlainBridge.terminalScrollback` round trip, a DOM/IPC concern that lives
 * in `TerminalPaneController`). [`scrollUp`] therefore lets `offset` grow
 * without any upper bound of its own; the pane controller is expected to
 * call [`clampOffset`] once it learns the actual retained-history size from
 * a fetch, rather than this module guessing or caching that number itself.
 * This mirrors `TerminalGridModel` vs. `PlainTerminalRenderer`'s existing
 * split between "pure position/state bookkeeping" and "the DOM/IPC-heavy
 * thing that acts on it".
 *
 * # Why new output never forces a jump back to live
 *
 * Per `docs/research/2026-07-24-libghostty-terminal.md`'s scrollback design
 * ("新输出到达时若在历史位置不强制跳底"): nothing in this class is driven by
 * incoming frames at all — the position only ever changes in response to an
 * explicit [`scrollUp`]/[`scrollDown`]/[`scrollToBottom`]/[`clampOffset`]
 * call, so a pane that keeps applying live frames to its retained grid model
 * while the user is parked at a history offset never has this state machine
 * silently reset out from under it.
 */

/**
 * Where a pane is currently looking. `"live"` means the pane renders its
 * normal, continuously-updated viewport (the existing F070 "WebView DOM 渲染"
 * behavior, unchanged); `"history"` means it is instead showing a fetched
 * scrollback window, `offset` rows (always `>= 1`) back from the live
 * bottom.
 */
export type TerminalScrollPosition =
	Readonly<{ kind: "live" }> | Readonly<{ kind: "history"; offset: number }>;

const LIVE_POSITION: TerminalScrollPosition = Object.freeze({ kind: "live" });

function historyPosition(offset: number): TerminalScrollPosition {
	return Object.freeze({ kind: "history", offset });
}

/**
 * One terminal pane's scrollback-viewing position. See the module doc for
 * why this deliberately carries no notion of "how much history exists" —
 * only [`clampOffset`] lets a caller fold that in, once it actually knows.
 */
export class TerminalScrollController {
	#position: TerminalScrollPosition = LIVE_POSITION;

	get position(): TerminalScrollPosition {
		return this.#position;
	}

	get isFollowingLive(): boolean {
		return this.#position.kind === "live";
	}

	/**
	 * Moves further back into history by `lines` (a non-positive `lines` is a
	 * no-op, returning the unchanged position). Scrolling up from `"live"`
	 * enters history at `offset: lines`.
	 */
	scrollUp(lines: number): TerminalScrollPosition {
		if (lines <= 0) {
			return this.#position;
		}
		const current = this.#position.kind === "live" ? 0 : this.#position.offset;
		this.#position = historyPosition(current + lines);
		return this.#position;
	}

	/**
	 * Moves back toward the live bottom by `lines`. A non-positive `lines`,
	 * or already being `"live"`, is a no-op. Crossing (or landing exactly on)
	 * the live boundary returns to `"live"` — this is the only way this
	 * class ever transitions back to `"live"` on its own.
	 */
	scrollDown(lines: number): TerminalScrollPosition {
		if (lines <= 0 || this.#position.kind === "live") {
			return this.#position;
		}
		const next = this.#position.offset - lines;
		this.#position = next <= 0 ? LIVE_POSITION : historyPosition(next);
		return this.#position;
	}

	/** Jumps straight back to `"live"`, regardless of current offset. */
	scrollToBottom(): void {
		this.#position = LIVE_POSITION;
	}

	/**
	 * Clamps the current offset down to `maxOffset` (called by
	 * `TerminalPaneController` once a scrollback fetch reveals how far back
	 * retained history actually reaches). A no-op while `"live"`, or while
	 * already within bounds. `maxOffset <= 0` returns to `"live"` (there is
	 * no history at all to show).
	 */
	clampOffset(maxOffset: number): TerminalScrollPosition {
		if (
			this.#position.kind === "history" &&
			this.#position.offset > maxOffset
		) {
			this.#position =
				maxOffset <= 0 ? LIVE_POSITION : historyPosition(maxOffset);
		}
		return this.#position;
	}
}
