/**
 * Pure, DOM/IPC-free decision state machine for `F190` S5 "live scrollback
 * 保持 anchor 并合并刷新" (see
 * `docs/research/2026-08-03-complete-terminal.md`'s "架构裁定 §5"). Like
 * `plain-terminal-scroll.ts`'s `TerminalScrollController`, this class only
 * tracks *whether a background `terminal_scrollback` refetch is currently
 * warranted* for one terminal pane — it never issues that IPC call itself,
 * never touches `TerminalPaneController`'s cache/repaint state, and knows
 * nothing about *why* a refresh is needed (parked in history, or a find
 * widget open — see that class's own module doc for the actual trigger
 * condition and how it wires this class's decisions to a real fetch).
 *
 * # The contract this enforces
 *
 * "pane 同时最多一个 fetch；fetch 期间到达的更多 frame 合并成一次后续
 * refresh": every call site that might want a refresh reports it via
 * [`markDirty`], which returns `true` (start a fetch now) only when none is
 * already running; while one is running, further `markDirty` calls just
 * flip an internal flag rather than returning `true` again, so no matter
 * how many frames arrive during one in-flight fetch, at most **one**
 * follow-up fetch ever gets queued — [`fetchCompleted`] (called once that
 * fetch resolves) reports whether that queued follow-up must start
 * immediately (`true`, and this controller stays "fetching") or whether the
 * pane is now fully caught up (`false`, back to idle).
 *
 * `TerminalPaneController` is expected to call `markDirty`/`fetchCompleted`
 * in matching pairs around every real fetch it starts (whether that fetch
 * was kicked off by this class's own `markDirty() === true` result, or by
 * an unrelated caller like the existing wheel-scroll scrollback discovery
 * fetch — see that class's own doc for why the two share one fetch slot) —
 * this class does not itself verify that pairing; it trusts its caller the
 * same way `TerminalScrollController` trusts callers to only pass it a
 * `maxOffset` it actually measured.
 */
export class TerminalLiveScrollbackRefreshController {
	#fetching = false;
	#dirty = false;

	/** `true` while a fetch this controller is tracking is in flight (i.e.
	 * since the `markDirty()` call that returned `true` started it, until
	 * the matching `fetchCompleted()` call reports no follow-up is needed). */
	get isFetching(): boolean {
		return this.#fetching;
	}

	/**
	 * Reports that fresh scrollback content may now be available (typically:
	 * a new frame arrived while the pane still needs a live-updating history
	 * view). Returns `true` when the caller should start a fetch right now —
	 * this call is what transitions the controller into "fetching". Returns
	 * `false` when a fetch is already in flight; the arrival is folded into
	 * that fetch's own follow-up via the internal dirty flag, so the caller
	 * must not start a second, concurrent fetch of its own.
	 */
	markDirty(): boolean {
		if (this.#fetching) {
			this.#dirty = true;
			return false;
		}
		this.#fetching = true;
		return true;
	}

	/**
	 * Reports that the fetch this controller is currently tracking has
	 * resolved. Returns `true` when one or more `markDirty()` calls arrived
	 * while it was in flight — the caller must start exactly one more fetch
	 * immediately, and this controller remains "fetching" for it (no
	 * separate `markDirty()` call is needed to re-enter that state — calling
	 * it anyway is harmless, since a `markDirty()` call while already
	 * fetching only ever sets the same dirty flag this method just
	 * consumed). Returns `false` once there is nothing left pending, at
	 * which point this controller returns to idle
	 * (`isFetching === false`).
	 */
	fetchCompleted(): boolean {
		if (this.#dirty) {
			this.#dirty = false;
			return true;
		}
		this.#fetching = false;
		return false;
	}

	/**
	 * Returns to idle immediately, discarding any pending dirty flag —
	 * called once the pane no longer needs a live-updating history view at
	 * all (back to live with no find widget open; see
	 * `TerminalPaneController`'s own doc). A fetch already in flight when
	 * this runs is not, and cannot be, cancelled (`TerminalStream.scrollback`
	 * has no abort signal); the caller is expected to simply stop acting on
	 * that fetch's eventual result once it is no longer needed, rather than
	 * this class pretending to cancel it.
	 */
	reset(): void {
		this.#fetching = false;
		this.#dirty = false;
	}
}
