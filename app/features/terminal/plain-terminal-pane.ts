import type {
	PlainBridge,
	TerminalFrame,
	TerminalScrollbackRow,
} from "../../platform/tauri/contracts";
import { normalizeCommandError } from "../../platform/tauri/errors";
import {
	attachTerminalStream,
	openTerminalStream,
	type TerminalStream,
} from "../../platform/tauri/terminal-stream";
import type { TerminalFutureTabDefaults } from "./plain-terminal-defaults";
import {
	TERMINAL_FIND_MAX_HIGHLIGHT_NODES,
	TERMINAL_FIND_MAX_QUERY_LENGTH,
	terminalScrollbackRowText,
	TerminalFindController,
} from "./plain-terminal-find";
import {
	encodeTerminalKeyEvent,
	TerminalImeController,
} from "./plain-terminal-input";
import { formatTerminalExitStatus } from "./plain-terminal-lifecycle";
import { TerminalLiveScrollbackRefreshController } from "./plain-terminal-live-refresh";
import {
	PlainTerminalRenderer,
	type TerminalFindHighlightPaint,
} from "./plain-terminal-renderer";
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
 * - **Shift+End** jumps straight back to the live bottom (leaving a find
 *   widget, if open, untouched — this is a navigation shortcut, not "input",
 *   see the "`F190` S5" section below for the distinction that matters).
 * - Actually typing (a real key sent to the pty, an IME commit, a paste, or
 *   the input-element fallback path — never a bare modifier press, and
 *   never the scrollback/find keyboard shortcuts above, which are all
 *   intercepted before reaching the pty) while parked in history **does**
 *   auto-return to live, and closes an open find widget — see the "`F190`
 *   S5" section below; this replaced the prior slice's "not done" behavior.
 *
 * A pane fetches scrollback **at most once per "scroll/find session"**: the
 * first `scrollUp` (or find-widget open) after being live with no history
 * need at all issues exactly one
 * `PlainBridge.terminalScrollback(sessionId, 0, TERMINAL_SCROLLBACK_DISCOVERY_LIMIT)`
 * call (mirroring `src-tauri/src/terminal/vt.rs`'s own
 * `TERMINAL_VT_MAX_SCROLLBACK_LINES` cap — starting at history row `0` and
 * asking for the whole configured cap in one shot both discovers exactly how
 * much history is actually retained *and* fetches its content in the same
 * round trip, since `terminal_scrollback` never errors for an
 * over-large range, see that command's own doc comment), caching every
 * returned row; every further `scrollUp`/`scrollDown` re-slices that cache,
 * with no further IPC calls of their own. Returning to live *and* closing
 * any find widget (`Shift+End` while find is closed, or the auto-return
 * described above) discards the cache and resets the refresh machinery
 * below — see [`#syncScrollbackRetention`].
 *
 * # `F190` S5 "live scrollback 保持 anchor 并合并刷新"
 *
 * The cache above is no longer a one-shot frozen snapshot for the whole
 * time a pane stays parked in history (or a find widget stays open) — see
 * [`#noteFrameForScrollbackRefresh`]. Whenever this pane still *needs* a
 * fresh scrollback view (parked in history, or a find widget is open —
 * [`#needsFreshScrollback`]) and a new frame arrives, this schedules a
 * background refetch, sharing the exact same single in-flight-fetch slot
 * (`#scrollbackFetch`) an ordinary `scrollUp` discovery fetch already uses —
 * "pane 同时最多一个 fetch" holds across *both* triggers, not just within
 * each independently. [`TerminalLiveScrollbackRefreshController`]
 * (`plain-terminal-live-refresh.ts`) is the pure decision state machine
 * behind "更多 frame 合并成一次后续 refresh": however many frames arrive
 * while one fetch is in flight, at most one follow-up fetch is ever queued.
 * Once a refresh actually lands, [`#repaintAfterScrollbackRefresh`] re-paints
 * at the pane's *current* [`TerminalScrollController`] offset — not a fresh
 * `"live"` position — which is what "保持 anchor（不跳动）、不强制跳底" means
 * in practice: the number of rows back from the live tip the user is looking
 * at never changes on its own, only the content at that distance can grow to
 * include newly-arrived output.
 *
 * # `F190` S5 "find and live scrollback": Cmd/Ctrl+F find widget
 *
 * `#registerListeners`' `keydown` handler intercepts Cmd+F (macOS) / Ctrl+F
 * (every platform — `encodeTerminalKeyEvent` alone does *not* filter a bare
 * Ctrl modifier, see that module's own doc comment) before it would ever
 * reach `forwardKey`, opening this pane's own find widget instead of either
 * forwarding a literal `Ctrl-F` byte to the pty or falling through to
 * whatever native browser/WKWebView find handling might otherwise trigger —
 * "不再依赖浏览器页内查找" (`docs/research/2026-08-03-complete-terminal.md`
 * §2). The widget's own `<input>`/buttons are a separate focusable DOM
 * subtree this pane's blanket "any mousedown in this pane focuses the
 * terminal" listener explicitly excludes (see that listener's own doc
 * comment) — without that exclusion, clicking into the find box would
 * immediately steal focus back to the terminal.
 *
 * The find widget's own query/case-sensitivity/match-navigation state lives
 * in [`TerminalFindController`] (`plain-terminal-find.ts`) — a pure,
 * DOM-free state machine this class feeds a `readonly string[]` corpus built
 * from (a) [`terminalScrollbackRowText`] over `#scrollbackCache` (fetched via
 * the exact same `#ensureScrollbackCache` a wheel-scroll uses) and (b)
 * `PlainTerminalRenderer.liveRowText` over the live grid's current rows —
 * together "最多 10,000 行 retained scrollback + 当前 viewport". This corpus
 * (and therefore the match set) is a **snapshot**, rebuilt only on an
 * explicit user action (opening the widget, editing the query, toggling
 * case) — a new frame arriving while find stays open does *not* silently
 * re-run the search underneath an in-progress navigation (`不得因新 frame
 * 崩掉查找状态`, and re-running mid-navigation would itself be a kind of
 * silent state churn this class avoids everywhere else); the S5 merge-
 * refresh mechanism above still keeps `#scrollbackCache` warm in the
 * background the whole time, so the *next* explicit query/reopen sees fresh
 * content.
 *
 * Navigating to a match ([`#revealActiveMatch`]) scrolls this pane's own
 * `TerminalScrollController`/renderer exactly the way a manual wheel scroll
 * would (`jumpTo`/`clampOffset` for a scrollback-origin match,
 * `scrollToBottom`/`showLive` for a live-viewport-origin one), then
 * [`#refreshFindHighlights`] paints highlight overlay `<div>`s
 * (`PlainTerminalRenderer.setFindHighlights`) for every currently-on-screen
 * match, capped at `TERMINAL_FIND_MAX_HIGHLIGHT_NODES` — never one DOM node
 * per match in the full (up to `TERMINAL_FIND_MAX_MATCHES`) match set.
 *
 * Typing directly into this pane's *terminal* input (not the find widget's
 * own input, a structurally separate element) while find is open closes the
 * widget entirely and returns to live — see [`#handleLiveInput`]'s own doc
 * comment for exactly which key paths trigger this and why a bare modifier
 * press must not.
 *
 * # `F190` S6 "真实 exit banner"
 *
 * A shell process that exits **on its own** (the user never asked this pane
 * to close) is not a reason to tear anything down: [`#handleExit`] shows a
 * real, accurate status line (see `plain-terminal-lifecycle.ts`'s
 * `formatTerminalExitStatus`) reporting the process's actual `exitCode`, or
 * the real signal name if it was signal-terminated (`exitCode` alone is not
 * meaningful then — see `TerminalExitEvent.signal`'s own doc comment), while
 * leaving the last painted frame exactly as it was. The pane stays fully
 * present — its close button (owned by `PlainTerminalView`) is what the user
 * clicks when actually done with it, at which point the ordinary explicit-
 * close path (`dispose()` → `stream.kill`) runs exactly as it always has.
 * `#exited` additionally guards every remaining path that would otherwise
 * write to the now-dead pty (a forwarded keystroke, an IME commit, a paste)
 * against issuing a doomed-to-fail IPC call once the process is confirmed
 * gone.
 *
 * This is a genuinely different case from an **explicit** user close (the
 * pane/tab close button, `Plain: Kill Terminal`): [`dispose`] calls
 * `stream.dispose()` — which synchronously unlistens this pane's own
 * `plain://terminal-exit` subscription — *before* it ever calls
 * `stream.kill`, so even though Rust's own waiter thread still reports a
 * real exit status for a killed session exactly like it does for a natural
 * one (see `terminal::service`'s module doc), this pane's own `onExit`
 * handler is already detached by the time that event could arrive and
 * simply never fires for that path. No extra bookkeeping is needed to tell
 * the two apart — only a natural exit can ever reach [`#handleExit`] at all.
 *
 * The complementary "last run's terminals could not be restored" one-time
 * notice is *not* this class's concern — that is a per-*view* (not
 * per-pane) concept `PlainTerminalView` owns, shown before any pane like
 * this one has even been created; see that class's own doc comment.
 *
 * # Not done in this slice
 *
 * - No per-cell scrollback color fidelity (see
 *   `plain-terminal-renderer.ts`'s `scrollbackCellAsTerminalCell` doc
 *   comment) — history text renders in the pane's default fg/bg plus
 *   whatever bold/italic/underline/etc. attributes its style does carry.
 * - No regex/whole-word find modes — plain substring matching only (see
 *   `plain-terminal-find.ts`'s own module doc).
 */

/** Mirrors `src-tauri/src/terminal/vt.rs`'s `TERMINAL_VT_MAX_SCROLLBACK_LINES`
 * — see the class doc's "Scrollback UX" section for why this is also the
 * one-shot discovery fetch size, not a per-page fetch size. */
const TERMINAL_SCROLLBACK_DISCOVERY_LIMIT = 10_000;

/** Lines scrolled per wheel tick — see the class doc's "Scrollback UX"
 * section for why this is a fixed step rather than `deltaY`-proportional. */
const TERMINAL_SCROLL_WHEEL_LINES = 3;

/** `KeyboardEvent.code` values that name a modifier key itself (as opposed
 * to a modifier *held while* pressing some other key) — see
 * `#handleLiveInput`'s own doc comment for why these must never be treated
 * as "the user typed something", even though `encodeTerminalKeyEvent` does
 * not filter them and they are genuinely written to the pty. */
const TERMINAL_MODIFIER_ONLY_CODES: ReadonlySet<string> = new Set([
	"ShiftLeft",
	"ShiftRight",
	"ControlLeft",
	"ControlRight",
	"AltLeft",
	"AltRight",
	"MetaLeft",
	"MetaRight",
	"CapsLock",
	"Fn",
	"FnLock",
	"NumLock",
	"ScrollLock",
]);

/** `F190` S5: what one entry of the find widget's search corpus actually
 * is — see `TerminalPaneController.#findLineOrigins`'s own doc comment. */
type TerminalFindLineOrigin =
	| { readonly kind: "scrollback"; readonly index: number }
	| { readonly kind: "viewport"; readonly index: number };

/** `F190` S5: the scrollback slice `#paintAtPosition` most recently handed
 * `PlainTerminalRenderer.showScrollbackRows` — `start`/`end` are
 * `#scrollbackCache` indices (half-open), `padCount` is how many blank rows
 * were painted above the real content (see that renderer method's own doc
 * comment on padding). `TerminalPaneController.#historyWindow`'s type. */
interface TerminalHistoryWindow {
	readonly start: number;
	readonly end: number;
	readonly padCount: number;
}

interface TerminalPaneBaseOptions {
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

/** An ordinary pane owns one immutable workspace root (plus, `F190` S2, one
 * immutable {@link TerminalFutureTabDefaults} profile/cwd identity); an
 * externally created DAP `runInTerminal` session already owns its native
 * cwd/shell and only supplies the existing session id. Keeping the two
 * shapes disjoint makes it impossible for a later selector change to
 * retarget an already-created shell. */
export type TerminalPaneOptions = TerminalPaneBaseOptions &
	(
		| {
				readonly rootId: string;
				/** `F190` S2: this pane's frozen profile/cwd identity, computed once
				 * by `PlainTerminalView` at tab-creation (or split) time from its
				 * two future-tab-default controls and never re-read afterward — see
				 * `plain-terminal-defaults.ts`'s own doc comment. */
				readonly defaults: TerminalFutureTabDefaults;
				readonly existingSessionId?: undefined;
		  }
		| {
				readonly rootId?: undefined;
				readonly defaults?: undefined;
				/** `F100` S4: when set, this pane **attaches** to an already-existing
				 * `TerminalService` session (created by Rust's own `runInTerminal`
				 * reverse-request handling,
				 * `debug::commands::handle_run_in_terminal_reverse_request`) via
				 * `attachTerminalStream` instead of starting a brand new one via
				 * `openTerminalStream`/`terminalStart` — see
				 * `plain-debug-terminal-integration.ts`'s own doc comment for the full
				 * flow from DAP reverse request to this option being set. Trust is still
				 * resolved first, exactly like an ordinary pane (an already-live session
				 * implies the workspace already passed a stricter debug-adapter trust
				 * gate, but this pane's own empty-workspace/declined status text is
				 * reused unconditionally for UI consistency across every pane kind). */
				readonly existingSessionId: string;
		  }
	);

export class TerminalPaneController {
	readonly #container: HTMLElement;
	readonly #bridge: PlainBridge;
	readonly #dialogService: TerminalTrustDialogService;
	readonly #isEmptyWorkspace: () => boolean;
	readonly #rootId: string | undefined;
	readonly #defaults: TerminalFutureTabDefaults | undefined;
	readonly #existingSessionId: string | undefined;
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
	/** `F190` S6 "真实 exit banner": `true` once this pane's own shell process
	 * has been observed to exit on its own — see the class doc's own section
	 * for why an explicit user close can never reach [`#handleExit`] at all. */
	#exited = false;
	/** Set by the first `scrollUp` of a scroll session; cleared whenever this
	 * pane returns to live — see the class doc's scrollback caching section. */
	#scrollbackCache: readonly TerminalScrollbackRow[] | undefined;
	/** The in-flight discovery fetch, if one is currently outstanding — see
	 * `#ensureScrollbackCache`'s own doc comment. */
	#scrollbackFetch:
		Promise<readonly TerminalScrollbackRow[] | undefined> | undefined;
	/** F190 S4 "Ghostty metadata and links": this pane's most recently
	 * reported OSC 7 working directory, already root-relative (see
	 * `TerminalFrame.pwd`'s own doc comment) — `undefined` until at least one
	 * frame carrying a non-`null` `pwd` has arrived. Read by
	 * `PlainTerminalView`'s split flow as the *live* cwd candidate for the
	 * new pane (see that method's own doc comment) — Rust still re-validates
	 * it via the exact same `resolve_cwd` containment check any other `cwd`
	 * goes through. */
	#pwd: string | undefined;

	/** `F190` S5: this pane's find widget query/match state machine — see
	 * the class doc's "find widget" section. */
	readonly #find = new TerminalFindController();
	/** `F190` S5: decides when a background scrollback refresh is warranted
	 * while this pane still needs a fresh history view — see the class
	 * doc's "live scrollback" section. */
	readonly #liveRefresh = new TerminalLiveScrollbackRefreshController();
	/** `F190` S5: `true` while the find widget panel is open — its DOM is
	 * always mounted (see the constructor); this is the logical
	 * open/closed flag `#needsFreshScrollback`/`#refreshFindHighlights`
	 * read. */
	#findWidgetOpen = false;
	/** `F190` S5: parallel array to whatever `lines` was last passed to
	 * `#find.setLines` — `#findLineOrigins[i]` describes what `lines[i]`
	 * actually is, letting a match's `lineIndex` be translated back into
	 * either a `#scrollbackCache` index or a live viewport row index. See
	 * `#rebuildFindCorpus`. */
	#findLineOrigins: readonly TerminalFindLineOrigin[] = [];
	/** `F190` S5: the scrollback window `#paintAtPosition` most recently
	 * painted, or `undefined` while live — lets `#refreshFindHighlights`
	 * translate a scrollback-origin match's cache index into the screen row
	 * it currently occupies without re-deriving `#paintAtPosition`'s own
	 * slicing math a second time. */
	#historyWindow: TerminalHistoryWindow | undefined;
	/** `F190` S5: find widget DOM handles, created once in the constructor —
	 * see `#buildFindWidget`. */
	#findElement: HTMLElement | undefined;
	#findInputElement: HTMLInputElement | undefined;
	#findCountElement: HTMLElement | undefined;
	#findHintElement: HTMLElement | undefined;

	constructor(options: TerminalPaneOptions) {
		this.#container = options.container;
		this.#bridge = options.bridge;
		this.#dialogService = options.dialogService;
		this.#isEmptyWorkspace = options.isEmptyWorkspace;
		this.#rootId = options.rootId;
		this.#defaults = options.defaults;
		this.#existingSessionId = options.existingSessionId;
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

		const findWidget = this.#buildFindWidget();

		this.#container.append(status, surface, input, findWidget);
		this.#statusElement = status;
		this.#inputElement = input;

		this.#renderer = new PlainTerminalRenderer({
			container: surface,
			onFramePainted: (sequence) => {
				void this.#stream?.ack(sequence);
			},
			// F190 S4 "Ghostty metadata and links": the renderer already
			// restricted this to a cell whose OSC 8 hyperlink is `http:`/
			// `https:` and to an explicit Cmd/Ctrl+Click (see
			// `PlainTerminalRendererOptions.onExternalLinkClick`'s own doc) —
			// this is the sole place that turns that into the one audited IPC
			// call that ever opens something outside a pty session. Errors
			// (a malformed URL somehow past the renderer's own check, or the
			// OS opener failing) are swallowed here exactly like every other
			// fire-and-forget bridge call in this class (`stream.focus`,
			// `stream.kill`) — there is no dedicated status surface for a
			// failed link open in this slice.
			onExternalLinkClick: (url) => {
				void this.#bridge.terminalOpenExternalLink(url).catch(() => {});
			},
		});

		this.#registerListeners(surface, input);
	}

	/**
	 * `F190` S5: builds (but does not yet show) this pane's find widget DOM —
	 * an `<input>`, a case-sensitivity toggle, a match-count label, prev/next
	 * buttons and a close button, all inside one `.plain-terminal-find`
	 * wrapper `hidden` by default. Mounted once, here, into `this.#container`
	 * by the constructor — never recreated by `#openFindWidget`/
	 * `#closeFindWidget`, which only toggle the `hidden` attribute and reset
	 * state.
	 */
	#buildFindWidget(): HTMLElement {
		const find = document.createElement("div");
		find.className = "plain-terminal-find";
		find.setAttribute("role", "search");
		find.hidden = true;

		const input = document.createElement("input");
		input.type = "text";
		input.className = "plain-terminal-find-input";
		input.setAttribute("aria-label", "Find in terminal");
		input.setAttribute("autocomplete", "off");
		input.setAttribute("autocorrect", "off");
		input.setAttribute("autocapitalize", "off");
		input.setAttribute("spellcheck", "false");
		// Deliberately no HTML `maxlength` attribute — that would let the
		// browser silently swallow keystrokes past the cap with zero visible
		// feedback, contradicting "超限显示准确的「已达上限」状态"
		// (`docs/research/2026-08-03-complete-terminal.md` §2). `#find.setQuery`
		// (via the `input` listener below) is this widget's one source of
		// truth for the cap, and `#renderFindStatus` surfaces it via
		// `#findHintElement` instead.

		const count = document.createElement("span");
		count.className = "plain-terminal-find-count";
		count.setAttribute("aria-live", "polite");

		const caseButton = document.createElement("button");
		caseButton.type = "button";
		caseButton.className = "plain-terminal-find-case";
		caseButton.setAttribute("aria-label", "Match Case");
		caseButton.setAttribute("aria-pressed", "false");
		caseButton.textContent = "Aa";

		const prevButton = document.createElement("button");
		prevButton.type = "button";
		prevButton.className = "plain-terminal-find-prev";
		prevButton.setAttribute("aria-label", "Previous Match");
		prevButton.textContent = "↑";

		const nextButton = document.createElement("button");
		nextButton.type = "button";
		nextButton.className = "plain-terminal-find-next";
		nextButton.setAttribute("aria-label", "Next Match");
		nextButton.textContent = "↓";

		const closeButton = document.createElement("button");
		closeButton.type = "button";
		closeButton.className = "plain-terminal-find-close";
		closeButton.setAttribute("aria-label", "Close Find");
		closeButton.textContent = "×";

		const hint = document.createElement("span");
		hint.className = "plain-terminal-find-hint";
		hint.setAttribute("aria-live", "polite");

		find.append(
			input,
			caseButton,
			count,
			prevButton,
			nextButton,
			closeButton,
			hint,
		);

		this.#findElement = find;
		this.#findInputElement = input;
		this.#findCountElement = count;
		this.#findHintElement = hint;

		const { signal } = this.#abort;
		input.addEventListener(
			"input",
			() => {
				this.#find.setQuery(input.value);
				this.#revealActiveMatch();
			},
			{ signal },
		);
		input.addEventListener(
			"keydown",
			(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					if (event.shiftKey) {
						this.#find.previous();
					} else {
						this.#find.next();
					}
					this.#revealActiveMatch();
					return;
				}
				if (event.key === "Escape") {
					event.preventDefault();
					this.#closeFindWidget();
					return;
				}
				if (
					!event.repeat &&
					(event.metaKey || event.ctrlKey) &&
					event.code === "KeyF"
				) {
					// Already open and already focused — re-selecting the query
					// text (instead of doing nothing, or letting a native
					// find-in-page trigger) is the one useful thing a repeated
					// Cmd/Ctrl+F can do from here.
					event.preventDefault();
					input.select();
				}
			},
			{ signal },
		);
		caseButton.addEventListener(
			"click",
			() => {
				const next = !this.#find.state.caseSensitive;
				caseButton.setAttribute("aria-pressed", String(next));
				this.#find.setCaseSensitive(next);
				this.#revealActiveMatch();
			},
			{ signal },
		);
		prevButton.addEventListener(
			"click",
			() => {
				this.#find.previous();
				this.#revealActiveMatch();
			},
			{ signal },
		);
		nextButton.addEventListener(
			"click",
			() => {
				this.#find.next();
				this.#revealActiveMatch();
			},
			{ signal },
		);
		closeButton.addEventListener(
			"click",
			() => {
				this.#closeFindWidget();
			},
			{ signal },
		);

		return find;
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

	/** F190 S4 "Ghostty metadata and links": this pane's current live,
	 * root-relative OSC 7 cwd candidate — see `#pwd`'s own doc comment. */
	get livePwd(): string | undefined {
		return this.#pwd;
	}

	/** F190 S4: jumps this pane's view to the nearest prompt row in the
	 * given direction (relative to whichever row the last jump landed on, or
	 * the bottom-most retained row on the first call) — see
	 * `PlainTerminalRenderer.jumpToAdjacentPrompt`'s own doc comment for the
	 * exact search/highlight behavior and its live-viewport-only scope.
	 * Returns whether a target row was actually found. */
	jumpToAdjacentPrompt(direction: "previous" | "next"): boolean {
		return this.#renderer.jumpToAdjacentPrompt(direction) !== undefined;
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

		const handlers = {
			onFrame: (frame: TerminalFrame, sequence: number) => {
				if (generation !== this.#generation) {
					return;
				}
				// `null` is itself meaningful (no OSC 7 pwd yet, or the shell's
				// current directory is no longer inside this pane's root — see
				// `TerminalFrame.pwd`'s doc comment) — this pane's cached
				// candidate must track that, not keep offering a stale one.
				this.#pwd = frame.pwd ?? undefined;
				// UI display half of "OSC 7 pwd 反映到 UI 展示并成为下一次 split
				// 的 cwd 候选" (`docs/research/2026-08-03-complete-terminal.md`
				// §3) — no dedicated tooltip/breadcrumb exists yet in this
				// slice; the attribute itself is the observable surface (and
				// what a later slice's richer display would read).
				if (this.#pwd === undefined) {
					delete this.#container.dataset.terminalPwd;
				} else {
					this.#container.dataset.terminalPwd = this.#pwd;
				}
				this.#renderer.applyFrame(frame, sequence);
				// `F190` S5 "live scrollback 保持 anchor 并合并刷新" — see the
				// class doc's own section and `#noteFrameForScrollbackRefresh`'s
				// doc comment.
				this.#noteFrameForScrollbackRefresh();
			},
			onExit: (exitCode: number, signal: string | null) => {
				if (generation !== this.#generation) {
					return;
				}
				this.#handleExit(exitCode, signal);
			},
		};

		let stream: TerminalStream;
		try {
			const rootId = this.#rootId;
			if (this.#existingSessionId !== undefined) {
				stream = await attachTerminalStream(
					this.#bridge,
					this.#existingSessionId,
					handlers,
				);
			} else {
				if (rootId === undefined) {
					throw new Error("Select a workspace folder for this terminal.");
				}
				const defaults = this.#defaults;
				// `F190` S2: a defaults value frozen as `invalidCwd` (only reachable
				// via a hand-edited `settings.json` — the settings UI itself never
				// persists an invalid cwd, see `plain-terminal-view.ts`) must never
				// reach `terminal_start` at all: showing `reason` here and returning
				// is this pane's entire response, exactly zero spawn attempts, per
				// "不得静默回退装作成功" (`docs/research/2026-08-03-complete-terminal.md`).
				if (defaults === undefined || defaults.kind === "invalidCwd") {
					throw new Error(
						defaults?.reason ?? "The terminal session could not be started.",
					);
				}
				stream = await openTerminalStream(
					this.#bridge,
					{
						rootId,
						profileId: defaults.profileId,
						cwd: defaults.cwd,
						cols,
						rows,
					},
					handlers,
				);
			}
		} catch (error) {
			if (generation !== this.#generation) {
				return;
			}
			// `normalizeCommandError` (not a bare `instanceof Error` check) so a
			// real Rust `CommandError` — e.g. `TERMINAL_PROFILE_INVALID` or
			// `TERMINAL_CWD_INVALID` if a hand-edited default slips past this
			// pane's own defaults check, or `WORKSPACE_NOT_TRUSTED`/root-not-
			// authorized — surfaces its own accurate, absolute-path-free message
			// instead of a generic fallback; every one of those fixed Rust/local
			// messages is written to never interpolate a raw path (see
			// `src-tauri/src/terminal/mod.rs`'s error constructors and
			// `plain-terminal-defaults.ts`'s validator), so this can never leak
			// one either.
			this.#showStatus(normalizeCommandError(error).message);
			return;
		}
		if (generation !== this.#generation) {
			stream.dispose();
			stream.kill(false).catch(() => {});
			return;
		}
		this.#stream = stream;
		// F190 S4 "Ghostty metadata and links": makes shell-integration
		// injection's own outcome observable on the pane itself (not just
		// internal state) — "降级必须可观察（准确状态），不得静默假装已注入"
		// (`docs/research/2026-08-03-complete-terminal.md` §3). No further UI
		// surfacing (tooltip/banner) exists yet in this slice; the attribute
		// is what a test (and, later, a richer status affordance) reads.
		this.#container.dataset.terminalShellIntegration = stream.shellIntegration;
		if (this.#existingSessionId !== undefined) {
			// The Rust side created this session with a fixed default geometry
			// (`RUN_IN_TERMINAL_DEFAULT_COLS`/`ROWS` — DAP's own
			// `RunInTerminalRequestArguments` carries no terminal size at all),
			// since no pane existed yet to measure against. Now that this pane
			// really has been laid out, resize to the real measured geometry —
			// exactly the same catch-up an ordinary pane's own later resize
			// calls already perform whenever its container's size changes.
			void stream.resize(cols, rows).catch(() => {});
		}
		void stream.focus(true);
		this.#inputElement.focus();
	}

	#showStatus(message: string | undefined): void {
		this.#statusElement.textContent = message ?? "";
	}

	/**
	 * `F190` S6 "真实 exit banner": handles this pane's shell process having
	 * exited **on its own** — see the class doc's own section for why an
	 * explicit user close (the pane/tab close button, `Plain: Kill Terminal`)
	 * can never reach this method at all. Idempotent (`#exited` guards a
	 * second call — `TerminalStreamHandlers.onExit`'s own doc comment already
	 * promises exactly one call per session, but this stays defensive rather
	 * than trusting that from a second layer down). Never disposes this pane
	 * or its stream — the last painted frame and every existing control
	 * (scroll, find, the close button) stay exactly as usable as before;
	 * only the accurate status line and the `#exited` write-guard below are
	 * new.
	 */
	#handleExit(exitCode: number, signal: string | null): void {
		if (this.#exited) {
			return;
		}
		this.#exited = true;
		this.#container.dataset.terminalExited = "true";
		this.#container.dataset.terminalExitCode = String(exitCode);
		if (signal === null) {
			delete this.#container.dataset.terminalExitSignal;
		} else {
			this.#container.dataset.terminalExitSignal = signal;
		}
		this.#showStatus(formatTerminalExitStatus(exitCode, signal));
	}

	#registerListeners(surface: HTMLElement, input: HTMLTextAreaElement): void {
		const { signal } = this.#abort;

		// Clicking anywhere in this pane (not just the 1x1 hidden input
		// itself) focuses its keyboard input — necessary once more than one
		// pane can be on screen at once (a split), so the user has a way to
		// redirect keyboard focus to a specific pane with the mouse. `F190`
		// S5: a click inside the find widget's own DOM subtree is excluded —
		// without this, clicking that widget's `<input>`/buttons would
		// immediately steal focus back to the terminal before the click even
		// registers on them, making the widget unusable by mouse.
		this.#container.addEventListener(
			"mousedown",
			(event) => {
				const target = event.target;
				if (
					target instanceof Node &&
					this.#findElement !== undefined &&
					this.#findElement.contains(target)
				) {
					return;
				}
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
			// `F190` S6: once this pane's own process has exited, there is
			// nothing left to write a keystroke to — see the class doc's "真实
			// exit banner" section for why this can never be an explicit-close
			// case instead (which tears the whole pane/stream down via
			// `dispose()`, not this guard).
			if (this.#exited) {
				return;
			}
			const encoded = encodeTerminalKeyEvent(event, direction);
			if (encoded === null) {
				return;
			}
			event.preventDefault();
			// `F190` S5: only a genuine "down" transition of a non-modifier key
			// counts as real input for the "typing returns to live" rule below
			// — see `#handleLiveInput`'s own doc comment for why a bare
			// modifier press (fired as its own `keydown`, e.g. the `Shift` in
			// `Shift+PageUp`) must not trigger it.
			if (
				direction === "down" &&
				!TERMINAL_MODIFIER_ONLY_CODES.has(event.code)
			) {
				this.#handleLiveInput();
			}
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
				// `F190` S5 "find and live scrollback": Cmd+F (macOS) / Ctrl+F
				// (every platform — `encodeTerminalKeyEvent` alone only ever
				// filters a held *Meta*, never a held Ctrl, see that module's own
				// doc comment) opens this pane's own find widget instead of
				// either reaching the pty or falling through to whatever native
				// browser/WKWebView find handling might otherwise trigger. Checked
				// before the Shift+PageUp/PageDown/End scrollback shortcuts below
				// since the two condition sets never overlap.
				if (
					!event.repeat &&
					(event.metaKey || event.ctrlKey) &&
					event.code === "KeyF"
				) {
					event.preventDefault();
					void this.#openFindWidget();
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
					this.#writeTextToPty(text);
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
					this.#writeTextToPty(text);
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
					this.#writeTextToPty(value);
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
	 * once) if none is cached and none is already in flight. Concurrent
	 * calls that arrive before that one fetch resolves — e.g. several wheel
	 * ticks dispatched in the same task, all before any `await` has had a
	 * chance to settle — share the *same* in-flight request via
	 * `#scrollbackFetch` rather than each starting their own, which is what
	 * actually makes "pane 同时最多一个 fetch" (see the class doc) hold even
	 * under bursty input, not just for a single, deliberately-spaced-out
	 * scroll gesture. `F190` S5: this same in-flight slot is shared with
	 * `#noteFrameForScrollbackRefresh`'s background refresh trigger — see
	 * `#startScrollbackFetch`'s own doc comment.
	 */
	async #ensureScrollbackCache(): Promise<
		readonly TerminalScrollbackRow[] | undefined
	> {
		if (this.#scrollbackCache !== undefined) {
			return this.#scrollbackCache;
		}
		if (this.#scrollbackFetch !== undefined) {
			return this.#scrollbackFetch;
		}
		this.#liveRefresh.markDirty();
		return this.#startScrollbackFetch();
	}

	/**
	 * `F190` S5: starts exactly one `terminal_scrollback` round trip and
	 * installs it as `#scrollbackFetch` *synchronously* (before this
	 * function's first `await`), so a second caller within the same task —
	 * whether another `#ensureScrollbackCache` call or
	 * `#noteFrameForScrollbackRefresh` — sees it already set and dedupes
	 * against it rather than starting a second, concurrent IPC call. Once
	 * the fetch resolves, consults `this.#liveRefresh.fetchCompleted()`: if
	 * more refresh need arrived while this fetch was outstanding, it
	 * immediately starts exactly one follow-up fetch and, once *that*
	 * resolves, repaints via `#repaintAfterScrollbackRefresh` — this
	 * function's own caller is expected to act on its return value directly
	 * (e.g. `#handleScrollUp` paints from it) rather than relying on this
	 * repaint, which only ever fires for a *background*-triggered refresh.
	 */
	#startScrollbackFetch(): Promise<
		readonly TerminalScrollbackRow[] | undefined
	> {
		// Captured now (not re-read after the `await`) so a `dispose()` that
		// runs while this fetch is outstanding is reliably detected below —
		// the same generation-guard convention `#startSession` and every
		// other async continuation in this class already follows. Unlike
		// those callers, nothing external awaits *this* function's own
		// recursive follow-up fetch, so this function must guard itself
		// rather than relying on a caller to.
		const generation = this.#generation;
		const stream = this.#stream;
		const fetch: Promise<readonly TerminalScrollbackRow[] | undefined> = (
			stream === undefined
				? Promise.resolve(undefined)
				: stream.scrollback(0, TERMINAL_SCROLLBACK_DISCOVERY_LIMIT).then(
						(result) => result.rows,
						() => undefined,
					)
		).then((rows) => {
			if (generation !== this.#generation) {
				return this.#scrollbackCache;
			}
			this.#scrollbackFetch = undefined;
			if (rows !== undefined) {
				this.#scrollbackCache = rows;
			}
			if (this.#liveRefresh.fetchCompleted()) {
				void this.#startScrollbackFetch().then(() => {
					if (generation === this.#generation) {
						this.#repaintAfterScrollbackRefresh();
					}
				});
			}
			return this.#scrollbackCache;
		});
		this.#scrollbackFetch = fetch;
		return fetch;
	}

	/**
	 * `F190` S5: called on every incoming frame (`#startSession`'s `onFrame`
	 * handler), regardless of view mode. While this pane still needs a fresh
	 * scrollback view (`#needsFreshScrollback`) *and* already has some
	 * cache/fetch history to refresh (the very first fetch for a given
	 * scroll/find need is always `#ensureScrollbackCache`'s job, triggered by
	 * the user action that created that need — this never races or
	 * duplicates that first fetch), reports the arrival to `#liveRefresh` and
	 * starts a background refetch when that reports one is warranted right
	 * now. See the class doc's "live scrollback" section.
	 */
	#noteFrameForScrollbackRefresh(): void {
		if (!this.#needsFreshScrollback()) {
			return;
		}
		if (
			this.#scrollbackCache === undefined &&
			this.#scrollbackFetch === undefined
		) {
			return;
		}
		if (!this.#liveRefresh.markDirty()) {
			return;
		}
		const generation = this.#generation;
		void this.#startScrollbackFetch().then(() => {
			if (generation === this.#generation) {
				this.#repaintAfterScrollbackRefresh();
			}
		});
	}

	/** `F190` S5: `true` while this pane's scrollback cache is worth keeping
	 * fresh in the background — parked in history, or the find widget is
	 * open (its corpus was built from that same cache — see the class doc's
	 * "find widget" section). */
	#needsFreshScrollback(): boolean {
		return !this.#scroll.isFollowingLive || this.#findWidgetOpen;
	}

	/** `F190` S5: drops the scrollback cache and resets the refresh
	 * machinery once neither reason to keep it warm applies any longer
	 * (`#needsFreshScrollback()` false) — called after every state change
	 * that could have made that so (returning to live, closing the find
	 * widget). A no-op while either reason still holds — e.g. `Shift+End`
	 * while the find widget stays open leaves the cache refreshing in the
	 * background, so a later find navigation into scrollback still sees
	 * fresh content. */
	#syncScrollbackRetention(): void {
		if (!this.#needsFreshScrollback()) {
			this.#scrollbackCache = undefined;
			this.#liveRefresh.reset();
		}
	}

	/** `F190` S5: re-paints after a background scrollback refresh actually
	 * lands (see `#startScrollbackFetch`/`#noteFrameForScrollbackRefresh`) —
	 * re-slices the fresh `#scrollbackCache` at the pane's *current* offset
	 * (`#paintAtPosition` never receives a fresh `"live"` position here),
	 * which is "保持 anchor" in practice: how far back from the live tip the
	 * user is looking never changes on its own, only the content at that
	 * distance can grow to include newly-arrived output. A no-op paint-wise
	 * while live (the ordinary live frame pipeline already painted this
	 * frame) — but still refreshes find highlights, since a live-mode find
	 * navigation may care about the freshly-refreshed cache the next time it
	 * runs. */
	#repaintAfterScrollbackRefresh(): void {
		if (!this.#scroll.isFollowingLive) {
			this.#paintAtPosition(this.#scroll.position);
		} else {
			this.#refreshFindHighlights();
		}
	}

	#handleScrollDown(lines: number): void {
		this.#paintAtPosition(this.#scroll.scrollDown(lines));
	}

	#handleScrollToBottom(): void {
		this.#scroll.scrollToBottom();
		this.#historyWindow = undefined;
		this.#renderer.showLive();
		this.#syncScrollbackRetention();
		this.#refreshFindHighlights();
	}

	/**
	 * `F190` S5: called by every keyboard/IME/paste path that actually sends
	 * real content to the pty (never a bare modifier press, and never the
	 * Cmd/Ctrl+F/Shift+PageUp/PageDown/End shortcuts, which are all
	 * intercepted before reaching here — see `#registerListeners`'s own call
	 * sites and `TERMINAL_MODIFIER_ONLY_CODES`). Returns to live if parked in
	 * history, and closes the find widget entirely if it was open — "输入
	 * （向 PTY 键入）显式回 live 并关闭/收起查找高亮"
	 * (`docs/research/2026-08-03-complete-terminal.md` §5/§2). Closing the
	 * widget outright (not merely dimming its highlight) is this class's own
	 * scope decision: the user just demonstrated they want to interact with
	 * the running program, not keep browsing find results, and a
	 * fully-closed, fully-reset widget is simpler to reason about (and test)
	 * than a "closed but remembers its query" half-state — reopening with
	 * Cmd/Ctrl+F is one keystroke away regardless.
	 */
	#handleLiveInput(): void {
		if (!this.#scroll.isFollowingLive) {
			this.#scroll.scrollToBottom();
			this.#historyWindow = undefined;
			this.#renderer.showLive();
		}
		if (this.#findWidgetOpen) {
			this.#closeFindWidget(false);
		}
		this.#syncScrollbackRetention();
	}

	/**
	 * `F190` S6: shared by every IME-commit/paste/input-fallback path that
	 * writes literal text to the pty (`forwardKey`'s own per-keystroke path
	 * has its own identical `#exited` guard, since it does not funnel through
	 * here) — no-ops once this pane's process has exited (see the class doc's
	 * "真实 exit banner" section) instead of issuing a doomed-to-fail IPC call
	 * against a session Rust still remembers but nothing is reading from
	 * anymore. Still runs `#handleLiveInput()` first, matching every prior
	 * call site's own "returns to live" behavior for genuine typed content.
	 */
	#writeTextToPty(text: string): void {
		this.#handleLiveInput();
		if (this.#exited) {
			return;
		}
		void this.#stream?.writeText(text);
	}

	/**
	 * `F190` S5: opens this pane's find widget — a no-op beyond refocusing
	 * (and re-selecting) its query input if already open. Fetches this
	 * pane's scrollback cache via the same `#ensureScrollbackCache` a
	 * wheel-scroll uses (a no-op IPC-wise if one is already cached or in
	 * flight), builds the find corpus from it plus the live viewport, and
	 * re-runs whatever query the input already holds (empty on a first open)
	 * — see the class doc's "find widget" section.
	 */
	async #openFindWidget(): Promise<void> {
		if (this.#findWidgetOpen) {
			this.#findInputElement?.focus();
			this.#findInputElement?.select();
			return;
		}
		this.#findWidgetOpen = true;
		this.#findElement?.removeAttribute("hidden");
		const generation = this.#generation;
		const cache = await this.#ensureScrollbackCache();
		if (generation !== this.#generation || !this.#findWidgetOpen) {
			// Disposed, or closed again (e.g. Escape) while this fetch was in
			// flight — never resurrect a widget the user already dismissed.
			return;
		}
		this.#rebuildFindCorpus(cache ?? []);
		this.#find.setQuery(this.#findInputElement?.value ?? "");
		this.#revealActiveMatch();
		this.#findInputElement?.focus();
		this.#findInputElement?.select();
	}

	/**
	 * `F190` S5: closes the find widget and fully resets its state (see
	 * `#handleLiveInput`'s doc comment for why this is a full reset, not a
	 * "closed but remembered" state). `focusTerminal` (default `true`) is
	 * only ever passed `false` by `#handleLiveInput`, since that caller's own
	 * event (a keystroke/paste/IME commit already directed at the terminal's
	 * input) means focus is already exactly where it should be — refocusing
	 * again there would be redundant, not incorrect, but is skipped anyway
	 * for clarity at that call site.
	 */
	#closeFindWidget(focusTerminal = true): void {
		if (!this.#findWidgetOpen) {
			return;
		}
		this.#findWidgetOpen = false;
		this.#findElement?.setAttribute("hidden", "");
		if (this.#findInputElement !== undefined) {
			this.#findInputElement.value = "";
		}
		this.#find.reset();
		this.#findLineOrigins = [];
		this.#renderer.setFindHighlights([]);
		this.#renderFindStatus();
		this.#syncScrollbackRetention();
		if (focusTerminal) {
			this.#inputElement.focus();
		}
	}

	/** `F190` S5: builds this pane's find corpus — every `cache` row (oldest
	 * first, each via `terminalScrollbackRowText`) followed by every current
	 * live viewport row (`PlainTerminalRenderer.liveRowText`) — and its
	 * parallel `#findLineOrigins`, then feeds the combined lines to
	 * `#find.setLines`. See the class doc's "find widget" section for why
	 * this corpus is a snapshot, not something later frame arrivals mutate. */
	#rebuildFindCorpus(cache: readonly TerminalScrollbackRow[]): void {
		const lines: string[] = [];
		const origins: TerminalFindLineOrigin[] = [];
		for (let index = 0; index < cache.length; index += 1) {
			lines.push(terminalScrollbackRowText(cache[index]!));
			origins.push({ kind: "scrollback", index });
		}
		const viewportRows = this.#renderer.rows;
		for (let row = 0; row < viewportRows; row += 1) {
			lines.push(this.#renderer.liveRowText(row));
			origins.push({ kind: "viewport", index: row });
		}
		this.#findLineOrigins = origins;
		this.#find.setLines(lines);
	}

	/**
	 * `F190` S5: scrolls this pane so the find widget's current active match
	 * (if any) is on screen, then refreshes highlights. A scrollback-origin
	 * match is placed roughly centered within the viewport via
	 * `TerminalScrollController.jumpTo` (still clamped by `#paintAtPosition`
	 * exactly like an ordinary wheel scroll would be); a viewport-origin
	 * match only needs `scrollToBottom`/`showLive` if this pane was not
	 * already live. Also a no-op scroll-wise (just refreshes highlights, so
	 * an empty/no-match query correctly clears any stale overlay) when there
	 * is no active match or its origin cannot be resolved — the latter is a
	 * defensive case that should not occur in practice, since every
	 * `TerminalFindMatch.lineIndex` `#find.state` can report was itself
	 * produced against `#findLineOrigins`'s own array in `#rebuildFindCorpus`.
	 */
	#revealActiveMatch(): void {
		const state = this.#find.state;
		const activeIndex = state.activeMatchIndex;
		const match =
			activeIndex === undefined ? undefined : state.matches[activeIndex];
		const origin =
			match === undefined ? undefined : this.#findLineOrigins[match.lineIndex];
		if (match === undefined || origin === undefined) {
			this.#refreshFindHighlights();
			return;
		}
		if (origin.kind === "viewport") {
			if (!this.#scroll.isFollowingLive) {
				this.#scroll.scrollToBottom();
				this.#historyWindow = undefined;
				this.#renderer.showLive();
				this.#syncScrollbackRetention();
			}
			this.#refreshFindHighlights();
			return;
		}
		const cache = this.#scrollbackCache;
		if (cache === undefined || cache.length === 0) {
			this.#refreshFindHighlights();
			return;
		}
		const viewportRows = this.#renderer.rows;
		const desiredEnd = Math.min(
			cache.length,
			Math.max(viewportRows, origin.index + Math.ceil(viewportRows / 2) + 1),
		);
		const offset = Math.max(1, cache.length - desiredEnd + 1);
		this.#paintAtPosition(this.#scroll.jumpTo(offset));
	}

	/**
	 * `F190` S5: recomputes which of `#find.state.matches` are currently on
	 * screen (mapping each via `#findLineOrigins` + `#historyWindow`/live
	 * mode into a screen row) and repaints the renderer's highlight overlay
	 * from them, capped at `TERMINAL_FIND_MAX_HIGHLIGHT_NODES` — see the
	 * class doc's "find widget" section. Also refreshes the widget's own
	 * count/limit status text (`#renderFindStatus`). A no-op beyond clearing
	 * any existing highlights while the widget is closed.
	 */
	#refreshFindHighlights(): void {
		if (!this.#findWidgetOpen) {
			this.#renderer.setFindHighlights([]);
			return;
		}
		const state = this.#find.state;
		const window = this.#historyWindow;
		const highlights: TerminalFindHighlightPaint[] = [];
		for (
			let index = 0;
			index < state.matches.length &&
			highlights.length < TERMINAL_FIND_MAX_HIGHLIGHT_NODES;
			index += 1
		) {
			const match = state.matches[index]!;
			const origin = this.#findLineOrigins[match.lineIndex];
			if (origin === undefined) {
				continue;
			}
			let screenRow: number | undefined;
			if (origin.kind === "viewport") {
				screenRow = window === undefined ? origin.index : undefined;
			} else if (
				window !== undefined &&
				origin.index >= window.start &&
				origin.index < window.end
			) {
				screenRow = window.padCount + (origin.index - window.start);
			}
			if (screenRow === undefined) {
				continue;
			}
			highlights.push(
				Object.freeze({
					rowIndex: screenRow,
					start: match.start,
					end: match.end,
					active: index === state.activeMatchIndex,
				}),
			);
		}
		this.#renderer.setFindHighlights(highlights);
		this.#renderFindStatus();
	}

	/** `F190` S5: updates the find widget's match-count/limit status text
	 * from `#find.state` — shared by every state-changing find action so the
	 * displayed count/index/"limit reached" text never drifts from the
	 * actual state machine. */
	#renderFindStatus(): void {
		const count = this.#findCountElement;
		const state = this.#find.state;
		if (count !== undefined) {
			if (state.query.length === 0) {
				count.textContent = "";
			} else if (state.matches.length === 0) {
				count.textContent = "No results";
			} else {
				const current = (state.activeMatchIndex ?? 0) + 1;
				count.textContent = state.matchesTruncated
					? `${current}/${state.matches.length}+ (limit reached)`
					: `${current}/${state.matches.length}`;
			}
		}
		const hint = this.#findHintElement;
		if (hint !== undefined) {
			hint.textContent = state.queryTruncated
				? `Query truncated to ${TERMINAL_FIND_MAX_QUERY_LENGTH} characters (limit reached).`
				: "";
		}
	}

	#paintAtPosition(position: TerminalScrollPosition): void {
		if (position.kind === "live") {
			this.#historyWindow = undefined;
			this.#syncScrollbackRetention();
			this.#renderer.showLive();
			this.#refreshFindHighlights();
			return;
		}
		const cache = this.#scrollbackCache;
		if (cache === undefined || cache.length === 0) {
			this.#historyWindow = undefined;
			this.#renderer.showLive();
			this.#refreshFindHighlights();
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
			this.#historyWindow = undefined;
			this.#syncScrollbackRetention();
			this.#renderer.showLive();
			this.#refreshFindHighlights();
			return;
		}
		const end = Math.min(
			cache.length,
			Math.max(viewportRows, cache.length - clamped.offset + 1),
		);
		const start = Math.max(0, end - viewportRows);
		const padCount = Math.max(0, viewportRows - (end - start));
		this.#historyWindow = Object.freeze({ start, end, padCount });
		this.#renderer.showScrollbackRows(cache.slice(start, end));
		this.#refreshFindHighlights();
	}
}
