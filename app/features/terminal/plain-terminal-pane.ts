import type {
	PlainBridge,
	TerminalScrollbackRow,
} from "../../platform/tauri/contracts";
import {
	openTerminalStream,
	type TerminalStream,
} from "../../platform/tauri/terminal-stream";
import {
	encodeTerminalKeyEvent,
	TerminalImeController,
} from "./plain-terminal-input";
import { PlainTerminalRenderer } from "./plain-terminal-renderer";
import {
	type TerminalScrollPosition,
	TerminalScrollController,
} from "./plain-terminal-scroll";
import {
	resolveTerminalTrust,
	TERMINAL_TRUST_DECLINED_STATUS_MESSAGE,
	TERMINAL_TRUST_EMPTY_WORKSPACE_STATUS_MESSAGE,
	type TerminalTrustDialogService,
} from "./plain-terminal-trust";

/**
 * One terminal pane — one PTY session, one [`PlainTerminalRenderer`], one
 * hidden-input keyboard/IME surface, one scrollback-viewing position (F070
 * "多 tab/split/scrollback + 生命周期" slice). Everything `PlainTerminalView`
 * used to do inline for its single, permanent session (see that file's own
 * history) now lives here instead, so a tab (or one side of a split tab) is
 * simply "one more `TerminalPaneController` mounted into one more DOM
 * wrapper" — `PlainTerminalView` itself is reduced to tab/split bookkeeping
 * (`TerminalTabsModel`) plus creating/laying out/disposing these.
 *
 * Deliberately imports nothing from `@codingame/monaco-vscode-api`: unlike
 * `plain-terminal-view.ts` (a real `ViewPane` needing DI-supplied Workbench
 * services), this class is plain DOM plus this domain's own bridge/stream
 * types, unlocked from any Workbench service dependency — unlike
 * `plain-terminal-view.ts` it therefore needs no
 * `ALLOWED_MONACO_APP_IMPORTS` entries of its own, matching
 * `plain-terminal-renderer.ts`/`plain-terminal-input.ts`/
 * `plain-terminal-trust.ts`'s existing "zero monaco deps" precedent. Native
 * `AbortController`-scoped listeners (rather than
 * `@codingame/monaco-vscode-api`'s `addDisposableListener`) is what keeps
 * that true while still cleanly disposing every listener this class
 * registers in one call.
 *
 * # Scrollback UX (this slice)
 *
 * - **Mouse wheel** scrolls by a fixed [`TERMINAL_SCROLL_WHEEL_LINES`] step
 *   per tick (not `deltaY`-proportional — real wheel/trackpad `deltaY`
 *   magnitudes vary wildly by platform and are not worth chasing pixel-exact
 *   fidelity for in this slice; a fixed step is simple and deterministic).
 * - **Shift+PageUp/Shift+PageDown** scroll by one full viewport page.
 *   Plain `PageUp`/`PageDown` (no Shift) are *not* intercepted — they are
 *   forwarded to the running program as normal terminal input, matching the
 *   convention most terminal emulators use (scrollback needs a modifier
 *   precisely so a full-screen program using bare PageUp/PageDown, e.g. a
 *   pager, keeps working normally).
 * - **Shift+End** jumps straight back to the live bottom.
 * - Typing while parked in history does **not** auto-return to live in this
 *   slice (deliberately out of scope — see the class doc's "not done"
 *   list); use Shift+End or scroll back down.
 *
 * A pane fetches scrollback **at most once per "scroll session"**: the
 * first `scrollUp` after being live issues exactly one
 * `PlainBridge.terminalScrollback(sessionId, 0, TERMINAL_SCROLLBACK_DISCOVERY_LIMIT)`
 * call (mirroring `src-tauri/src/terminal/vt.rs`'s own
 * `TERMINAL_VT_MAX_SCROLLBACK_LINES` cap — starting at history row `0` and
 * asking for the whole configured cap in one shot both discovers exactly how
 * much history is actually retained *and* fetches its content in the same
 * round trip, since `terminal_scrollback` never errors for an
 * over-large range, see that command's own doc comment), caching every
 * returned row for the rest of that session; every further `scrollUp`/
 * `scrollDown` while still away from live only re-slices that cache, with no
 * further IPC calls. Returning to live (`scrollDown` crossing back past the
 * boundary, or `Shift+End`) discards the cache — the *next* time the user
 * scrolls up, a fresh fetch runs, so a long-idle-then-resumed scrollback
 * session cannot show output that arrived after the cache was built. This is
 * a deliberate, documented simplification (a stable snapshot for the
 * duration of one continuous browse, not a live-updating history view) —
 * see the class doc's "not done" list.
 *
 * # Not done in this slice
 *
 * - No live-updating scrollback (see above): a history view is a frozen
 *   snapshot of whatever was retained at the moment scrolling began.
 * - No auto-return-to-live on typing.
 * - No per-cell scrollback color fidelity (see
 *   `plain-terminal-renderer.ts`'s `scrollbackCellAsTerminalCell` doc
 *   comment) — history text renders in the pane's default fg/bg plus
 *   whatever bold/italic/underline/etc. attributes its style does carry.
 */

/** Mirrors `src-tauri/src/terminal/vt.rs`'s `TERMINAL_VT_MAX_SCROLLBACK_LINES`
 * — see the class doc's "Scrollback UX" section for why this is also the
 * one-shot discovery fetch size, not a per-page fetch size. */
const TERMINAL_SCROLLBACK_DISCOVERY_LIMIT = 10_000;

/** Lines scrolled per wheel tick — see the class doc's "Scrollback UX"
 * section for why this is a fixed step rather than `deltaY`-proportional. */
const TERMINAL_SCROLL_WHEEL_LINES = 3;

export interface TerminalPaneOptions {
	/** The `.plain-terminal-pane` wrapper this controller mounts its status/
	 * surface/input elements into — owned and sized by `PlainTerminalView`,
	 * never created by this class itself. */
	readonly container: HTMLElement;
	readonly bridge: PlainBridge;
	readonly dialogService: TerminalTrustDialogService;
	/** Read fresh at session-start time (not cached at construction) — the
	 * same timing the prior single-session `PlainTerminalView` used. */
	readonly isEmptyWorkspace: () => boolean;
}

export class TerminalPaneController {
	readonly #container: HTMLElement;
	readonly #bridge: PlainBridge;
	readonly #dialogService: TerminalTrustDialogService;
	readonly #isEmptyWorkspace: () => boolean;
	readonly #abort = new AbortController();
	readonly #ime = new TerminalImeController();
	readonly #scroll = new TerminalScrollController();
	readonly #renderer: PlainTerminalRenderer;
	readonly #statusElement: HTMLElement;
	readonly #inputElement: HTMLTextAreaElement;

	/** Guards async continuations (trust resolution, `terminalStart`, a
	 * scrollback fetch) from touching state after this pane has been
	 * disposed — mirrors the prior single-session `PlainTerminalView`'s own
	 * generation guard. */
	#generation = 0;
	#started = false;
	#disposed = false;
	#stream: TerminalStream | undefined;
	#lastRequestedCols = 0;
	#lastRequestedRows = 0;
	/** Set by the first `scrollUp` of a scroll session; cleared whenever this
	 * pane returns to live — see the class doc's scrollback caching section. */
	#scrollbackCache: readonly TerminalScrollbackRow[] | undefined;
	/** The in-flight discovery fetch, if one is currently outstanding — see
	 * `#ensureScrollbackCache`'s own doc comment. */
	#scrollbackFetch:
		Promise<readonly TerminalScrollbackRow[] | undefined> | undefined;

	constructor(options: TerminalPaneOptions) {
		this.#container = options.container;
		this.#bridge = options.bridge;
		this.#dialogService = options.dialogService;
		this.#isEmptyWorkspace = options.isEmptyWorkspace;
		this.#container.classList.add("plain-terminal-pane");

		const status = document.createElement("div");
		status.className = "plain-terminal-status";
		status.setAttribute("role", "status");

		const surface = document.createElement("div");
		surface.className = "plain-terminal-surface-wrapper";

		// The single always-focused, visually hidden input surface — see
		// `plain-terminal-view.ts`'s prior history for why a hidden
		// `<textarea>` (not a plain `<div>`) is what real
		// `keydown`/`compositionstart`/etc. events need to fire reliably.
		const input = document.createElement("textarea");
		input.className = "plain-terminal-input";
		input.setAttribute("aria-label", "Terminal input");
		input.setAttribute("autocomplete", "off");
		input.setAttribute("autocorrect", "off");
		input.setAttribute("autocapitalize", "off");
		input.setAttribute("spellcheck", "false");
		input.setAttribute("wrap", "off");
		input.rows = 1;

		this.#container.append(status, surface, input);
		this.#statusElement = status;
		this.#inputElement = input;

		this.#renderer = new PlainTerminalRenderer({
			container: surface,
			onFramePainted: (sequence) => {
				void this.#stream?.ack(sequence);
			},
		});

		this.#registerListeners(surface, input);
	}

	/** Mirrors the prior `PlainTerminalView.layoutBody`'s exact math and
	 * zero-size defensiveness — see that method's own history for why. */
	layout(width: number, height: number): void {
		if (width <= 0 || height <= 0) {
			return;
		}
		const cellSize = this.#renderer.measureCellSizePx();
		if (
			!Number.isFinite(cellSize.width) ||
			!Number.isFinite(cellSize.height) ||
			cellSize.width <= 0 ||
			cellSize.height <= 0
		) {
			return;
		}
		const cols = Math.max(1, Math.floor(width / cellSize.width));
		const rows = Math.max(1, Math.floor(height / cellSize.height));

		if (!this.#started) {
			this.#started = true;
			this.#lastRequestedCols = cols;
			this.#lastRequestedRows = rows;
			void this.#startSession(cols, rows);
			return;
		}
		if (cols !== this.#lastRequestedCols || rows !== this.#lastRequestedRows) {
			this.#lastRequestedCols = cols;
			this.#lastRequestedRows = rows;
			void this.#stream?.resize(cols, rows);
		}
	}

	focus(): void {
		this.#inputElement.focus();
	}

	/** Kills this pane's session (fire-and-forget, `immediate: false` —
	 * mirrors the prior single-session view's own dispose behavior) and
	 * releases every listener/DOM resource this controller owns. Idempotent —
	 * safe to call more than once (e.g. once from `PlainTerminalView`'s own
	 * dispose sweep even if a tab/pane close already called it). */
	dispose(): void {
		if (this.#disposed) {
			return;
		}
		this.#disposed = true;
		this.#generation += 1;
		this.#abort.abort();
		const stream = this.#stream;
		this.#stream = undefined;
		if (stream !== undefined) {
			stream.dispose();
			stream.kill(false).catch(() => {});
		}
		this.#renderer.dispose();
	}

	async #startSession(cols: number, rows: number): Promise<void> {
		const generation = this.#generation;
		const decision = await resolveTerminalTrust(
			this.#bridge,
			this.#dialogService,
			this.#isEmptyWorkspace(),
		);
		if (generation !== this.#generation) {
			return;
		}
		if (decision.kind === "empty-workspace") {
			this.#showStatus(TERMINAL_TRUST_EMPTY_WORKSPACE_STATUS_MESSAGE);
			return;
		}
		if (decision.kind === "declined") {
			this.#showStatus(TERMINAL_TRUST_DECLINED_STATUS_MESSAGE);
			return;
		}
		this.#showStatus(undefined);

		let stream: TerminalStream;
		try {
			stream = await openTerminalStream(
				this.#bridge,
				{ cwd: null, cols, rows },
				{
					onFrame: (frame, sequence) => {
						if (generation !== this.#generation) {
							return;
						}
						this.#renderer.applyFrame(frame, sequence);
					},
					onExit: () => {
						// This slice renders no explicit "process exited" banner yet
						// (mirrors the prior single-session view) — the last painted
						// frame simply stays on screen.
					},
				},
			);
		} catch (error) {
			if (generation !== this.#generation) {
				return;
			}
			this.#showStatus(
				error instanceof Error
					? error.message
					: "The terminal session could not be started.",
			);
			return;
		}
		if (generation !== this.#generation) {
			stream.dispose();
			stream.kill(false).catch(() => {});
			return;
		}
		this.#stream = stream;
		void stream.focus(true);
		this.#inputElement.focus();
	}

	#showStatus(message: string | undefined): void {
		this.#statusElement.textContent = message ?? "";
	}

	#registerListeners(surface: HTMLElement, input: HTMLTextAreaElement): void {
		const { signal } = this.#abort;

		// Clicking anywhere in this pane (not just the 1x1 hidden input
		// itself) focuses its keyboard input — necessary once more than one
		// pane can be on screen at once (a split), so the user has a way to
		// redirect keyboard focus to a specific pane with the mouse.
		this.#container.addEventListener(
			"mousedown",
			() => {
				input.focus();
			},
			{ signal },
		);

		const forwardKey = (
			event: KeyboardEvent,
			direction: "down" | "up",
		): void => {
			if (this.#ime.active) {
				return;
			}
			const encoded = encodeTerminalKeyEvent(event, direction);
			if (encoded === null) {
				return;
			}
			event.preventDefault();
			void this.#stream?.writeKey(
				encoded.action,
				encoded.key,
				encoded.mods,
				encoded.utf8,
			);
		};

		input.addEventListener(
			"keydown",
			(event) => {
				if (this.#ime.active) {
					return;
				}
				if (event.shiftKey && !event.repeat) {
					if (event.key === "PageUp") {
						event.preventDefault();
						void this.#handleScrollUp(this.#renderer.rows);
						return;
					}
					if (event.key === "PageDown") {
						event.preventDefault();
						this.#handleScrollDown(this.#renderer.rows);
						return;
					}
					if (event.key === "End") {
						event.preventDefault();
						this.#handleScrollToBottom();
						return;
					}
				}
				forwardKey(event, "down");
			},
			{ signal },
		);
		input.addEventListener(
			"keyup",
			(event) => {
				forwardKey(event, "up");
			},
			{ signal },
		);
		input.addEventListener(
			"compositionstart",
			() => {
				this.#ime.start();
			},
			{ signal },
		);
		input.addEventListener(
			"compositionupdate",
			(event) => {
				this.#ime.update({ data: event.data ?? "" });
			},
			{ signal },
		);
		input.addEventListener(
			"compositionend",
			(event) => {
				const text = this.#ime.end({ data: event.data ?? "" });
				input.value = "";
				if (text.length > 0) {
					void this.#stream?.writeText(text);
				}
			},
			{ signal },
		);
		input.addEventListener(
			"paste",
			(event) => {
				event.preventDefault();
				const text = event.clipboardData?.getData("text/plain") ?? "";
				if (text.length > 0) {
					void this.#stream?.writeText(text);
				}
			},
			{ signal },
		);
		// Fallback catch-all — see the prior single-session view's own doc
		// comment on this listener for why it should only ever fire for an
		// edge case.
		input.addEventListener(
			"input",
			() => {
				if (this.#ime.active) {
					return;
				}
				const { value } = input;
				if (value.length > 0) {
					input.value = "";
					void this.#stream?.writeText(value);
				}
			},
			{ signal },
		);
		input.addEventListener(
			"focus",
			() => {
				void this.#stream?.focus(true);
			},
			{ signal },
		);
		input.addEventListener(
			"blur",
			() => {
				void this.#stream?.focus(false);
			},
			{ signal },
		);

		surface.addEventListener(
			"wheel",
			(event) => {
				event.preventDefault();
				if (event.deltaY < 0) {
					void this.#handleScrollUp(TERMINAL_SCROLL_WHEEL_LINES);
				} else if (event.deltaY > 0) {
					this.#handleScrollDown(TERMINAL_SCROLL_WHEEL_LINES);
				}
			},
			{ signal, passive: false },
		);
	}

	async #handleScrollUp(lines: number): Promise<void> {
		const generation = this.#generation;
		const cache = await this.#ensureScrollbackCache();
		if (generation !== this.#generation) {
			return;
		}
		if (cache === undefined || cache.length === 0) {
			// Nothing retained (or the fetch failed/this pane has no session
			// yet) — stay live rather than show an all-blank "history" view.
			return;
		}
		this.#paintAtPosition(this.#scroll.scrollUp(lines));
	}

	/**
	 * Returns this pane's cached scrollback rows, fetching them (exactly
	 * once) if this is the first call since the last time this pane was
	 * live. Concurrent calls that arrive before that one fetch resolves —
	 * e.g. several wheel ticks dispatched in the same task, all before any
	 * `await` has had a chance to settle — share the *same* in-flight
	 * request via `#scrollbackFetch` rather than each starting their own,
	 * which is what actually makes "at most one `terminalScrollback` call
	 * per scroll session" (see the class doc) hold even under bursty input,
	 * not just for a single, deliberately-spaced-out scroll gesture.
	 */
	async #ensureScrollbackCache(): Promise<
		readonly TerminalScrollbackRow[] | undefined
	> {
		if (this.#scrollbackCache !== undefined) {
			return this.#scrollbackCache;
		}
		if (this.#scrollbackFetch === undefined) {
			const stream = this.#stream;
			this.#scrollbackFetch =
				stream === undefined
					? Promise.resolve(undefined)
					: stream.scrollback(0, TERMINAL_SCROLLBACK_DISCOVERY_LIMIT).then(
							(result) => result.rows,
							() => undefined,
						);
		}
		const rows = await this.#scrollbackFetch;
		this.#scrollbackFetch = undefined;
		if (rows !== undefined && this.#scrollbackCache === undefined) {
			this.#scrollbackCache = rows;
		}
		return this.#scrollbackCache;
	}

	#handleScrollDown(lines: number): void {
		this.#paintAtPosition(this.#scroll.scrollDown(lines));
	}

	#handleScrollToBottom(): void {
		this.#scroll.scrollToBottom();
		this.#scrollbackCache = undefined;
		this.#renderer.showLive();
	}

	#paintAtPosition(position: TerminalScrollPosition): void {
		if (position.kind === "live") {
			this.#scrollbackCache = undefined;
			this.#renderer.showLive();
			return;
		}
		const cache = this.#scrollbackCache;
		if (cache === undefined || cache.length === 0) {
			this.#renderer.showLive();
			return;
		}
		const viewportRows = this.#renderer.rows;
		// Once `start` (below) would reach `0` — the oldest retained row is
		// already the topmost visible line — further scrolling must not keep
		// shrinking the visible window toward nothing; clamping the offset
		// here pins the view at "oldest content at the top" instead. See the
		// class doc's scrollback caching section.
		const maxOffset = Math.max(1, cache.length - viewportRows + 1);
		const clamped = this.#scroll.clampOffset(maxOffset);
		if (clamped.kind === "live") {
			this.#scrollbackCache = undefined;
			this.#renderer.showLive();
			return;
		}
		const end = Math.min(
			cache.length,
			Math.max(viewportRows, cache.length - clamped.offset + 1),
		);
		const start = Math.max(0, end - viewportRows);
		this.#renderer.showScrollbackRows(cache.slice(start, end));
	}
}
